import { isMediaInUse, pathKey } from "../core/media/media";
import { createEmptyProject } from "../core/project/project";
import { PROJECT_EXTENSION, type MediaRef, type Project } from "../core/project/schema";
import { addClip, deleteClips, moveClip, splitClip, trimClip, type AddClipParams } from "../core/timeline/ops";
import type { Micros } from "../core/time";

/** Quantos estados o desfazer guarda. */
export const HISTORY_LIMIT = 200;

/** O projeto aberto na janela, seu histórico e sua relação com o arquivo em disco. */
export interface ProjectDocument {
  project: Project;
  /** `null` enquanto o projeto nunca foi salvo. */
  filePath: string | null;
  /** Versão que está gravada em disco (ou a inicial, se nunca foi salvo). */
  savedProject: Project;
  /** Há alterações em relação a `savedProject`. Desfazer até ela limpa o indicador. */
  dirty: boolean;
  /** Estados anteriores (o último é o mais recente). */
  past: Project[];
  /** Estados desfeitos que podem ser refeitos (o último é o próximo). */
  future: Project[];
  /** Motivo da última edição recusada, para exibir ao usuário. */
  lastError: string | null;
}

/** Ações que alteram o projeto e entram no histórico. */
export type EditAction =
  | { type: "rename"; name: string }
  /** Acrescenta mídias; arquivos já presentes no projeto (mesmo caminho) são ignorados. */
  | { type: "addMedia"; media: MediaRef[] }
  /** Remove uma mídia da biblioteca; ignorado se algum clipe a usa. */
  | { type: "removeMedia"; mediaId: string }
  | ({ type: "addClip" } & AddClipParams)
  | { type: "moveClip"; clipId: string; trackId?: string; startUs: Micros }
  | { type: "trimClip"; clipId: string; edge: "start" | "end"; atUs: Micros }
  | { type: "splitClip"; clipId: string; atUs: Micros; newClipId: string }
  | { type: "deleteClips"; clipIds: string[] };

export type DocumentAction =
  | { type: "new"; project: Project }
  | { type: "loaded"; project: Project; filePath: string }
  | { type: "saved"; project: Project; filePath: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clearError" }
  | EditAction;

export const DEFAULT_PROJECT_NAME = "Projeto sem título";

function fresh(project: Project, filePath: string | null): ProjectDocument {
  return { project, filePath, savedProject: project, dirty: false, past: [], future: [], lastError: null };
}

export function initialDocument(): ProjectDocument {
  return fresh(createEmptyProject(DEFAULT_PROJECT_NAME), null);
}

/** Calcula o próximo projeto; `null` = nada mudou; string = edição recusada. */
function applyEdit(project: Project, action: EditAction): Project | null | string {
  switch (action.type) {
    case "rename": {
      const name = action.name.trim();
      return !name || name === project.name ? null : { ...project, name };
    }
    case "addMedia": {
      const known = new Set(project.media.map((m) => pathKey(m.path)));
      const added: MediaRef[] = [];
      for (const m of action.media) {
        if (known.has(pathKey(m.path))) continue;
        known.add(pathKey(m.path));
        added.push(m);
      }
      return added.length ? { ...project, media: [...project.media, ...added] } : null;
    }
    case "removeMedia":
      if (!project.media.some((m) => m.id === action.mediaId)) return null;
      if (isMediaInUse(project, action.mediaId)) return "a mídia está em uso na timeline";
      return { ...project, media: project.media.filter((m) => m.id !== action.mediaId) };
    case "addClip": {
      const { type: _t, ...params } = action;
      return unwrap(addClip(project, params));
    }
    case "moveClip":
      return unwrap(moveClip(project, action.clipId, { trackId: action.trackId, startUs: action.startUs }));
    case "trimClip":
      return unwrap(trimClip(project, action.clipId, action.edge, action.atUs));
    case "splitClip":
      return unwrap(splitClip(project, action.clipId, action.atUs, action.newClipId));
    case "deleteClips":
      return unwrap(deleteClips(project, action.clipIds));
  }
}

function unwrap(r: { ok: true; project: Project } | { ok: false; error: string }): Project | string {
  return r.ok ? r.project : r.error;
}

function withProject(doc: ProjectDocument, project: Project, past: Project[], future: Project[]): ProjectDocument {
  return { ...doc, project, past, future, dirty: project !== doc.savedProject, lastError: null };
}

export function documentReducer(doc: ProjectDocument, action: DocumentAction): ProjectDocument {
  switch (action.type) {
    case "new":
      return fresh(action.project, null);
    case "loaded":
      return fresh(action.project, action.filePath);
    case "saved":
      // O histórico é mantido; o estado gravado passa a ser a referência de "não salvo".
      return { ...doc, project: action.project, savedProject: action.project, filePath: action.filePath, dirty: false };
    case "undo": {
      const prev = doc.past[doc.past.length - 1];
      if (!prev) return doc;
      return withProject(doc, prev, doc.past.slice(0, -1), [...doc.future, doc.project]);
    }
    case "redo": {
      const next = doc.future[doc.future.length - 1];
      if (!next) return doc;
      return withProject(doc, next, [...doc.past, doc.project], doc.future.slice(0, -1));
    }
    case "clearError":
      return doc.lastError === null ? doc : { ...doc, lastError: null };
    default: {
      const next = applyEdit(doc.project, action);
      if (next === null) return doc;
      if (typeof next === "string") return { ...doc, lastError: next };
      const past = [...doc.past, doc.project].slice(-HISTORY_LIMIT);
      return withProject(doc, next, past, []);
    }
  }
}

export const canUndo = (doc: ProjectDocument) => doc.past.length > 0;
export const canRedo = (doc: ProjectDocument) => doc.future.length > 0;

/** Nome do arquivo sem pasta nem extensão: `C:\a\Meu filme.ncproj` → `Meu filme`. */
export function fileStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(new RegExp(`\\.${PROJECT_EXTENSION}$`, "i"), "");
}

/** Garante a extensão .ncproj no caminho escolhido pelo usuário. */
export function withProjectExtension(path: string): string {
  return new RegExp(`\\.${PROJECT_EXTENSION}$`, "i").test(path) ? path : `${path}.${PROJECT_EXTENSION}`;
}

/**
 * Versão do projeto a gravar: atualiza `modifiedAt` e, se o projeto ainda usa o
 * nome padrão, adota o nome do arquivo.
 */
export function prepareForSave(project: Project, filePath: string, now: Date = new Date()): Project {
  const name = project.name === DEFAULT_PROJECT_NAME ? fileStem(filePath) || project.name : project.name;
  return { ...project, name, modifiedAt: now.toISOString() };
}

export function windowTitle(doc: ProjectDocument): string {
  return `${doc.dirty ? "• " : ""}${doc.project.name} — NovaCut`;
}
