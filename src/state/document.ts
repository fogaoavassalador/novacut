import { isMediaInUse, pathKey } from "../core/media/media";
import { createEmptyProject } from "../core/project/project";
import { PROJECT_EXTENSION, type MediaRef, type Project } from "../core/project/schema";

/** O projeto aberto na janela e sua relação com o arquivo em disco. */
export interface ProjectDocument {
  project: Project;
  /** `null` enquanto o projeto nunca foi salvo. */
  filePath: string | null;
  /** Há alterações ainda não gravadas. */
  dirty: boolean;
}

export type DocumentAction =
  | { type: "new"; project: Project }
  | { type: "loaded"; project: Project; filePath: string }
  | { type: "rename"; name: string }
  | { type: "saved"; project: Project; filePath: string }
  /** Acrescenta mídias; arquivos já presentes no projeto (mesmo caminho) são ignorados. */
  | { type: "addMedia"; media: MediaRef[] }
  /** Remove uma mídia da biblioteca; ignorado se algum clipe a usa. */
  | { type: "removeMedia"; mediaId: string };

export const DEFAULT_PROJECT_NAME = "Projeto sem título";

export function initialDocument(): ProjectDocument {
  return { project: createEmptyProject(DEFAULT_PROJECT_NAME), filePath: null, dirty: false };
}

export function documentReducer(doc: ProjectDocument, action: DocumentAction): ProjectDocument {
  switch (action.type) {
    case "new":
      return { project: action.project, filePath: null, dirty: false };
    case "loaded":
      return { project: action.project, filePath: action.filePath, dirty: false };
    case "rename": {
      const name = action.name.trim();
      if (!name || name === doc.project.name) return doc;
      return { ...doc, project: { ...doc.project, name }, dirty: true };
    }
    case "saved":
      return { project: action.project, filePath: action.filePath, dirty: false };
    case "addMedia": {
      const known = new Set(doc.project.media.map((m) => pathKey(m.path)));
      const added: MediaRef[] = [];
      for (const m of action.media) {
        if (known.has(pathKey(m.path))) continue;
        known.add(pathKey(m.path));
        added.push(m);
      }
      if (!added.length) return doc;
      return { ...doc, project: { ...doc.project, media: [...doc.project.media, ...added] }, dirty: true };
    }
    case "removeMedia": {
      const { project } = doc;
      if (!project.media.some((m) => m.id === action.mediaId) || isMediaInUse(project, action.mediaId))
        return doc;
      return {
        ...doc,
        project: { ...project, media: project.media.filter((m) => m.id !== action.mediaId) },
        dirty: true,
      };
    }
  }
}

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
