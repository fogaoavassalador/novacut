import { createEmptyProject } from "../core/project/project";
import { PROJECT_EXTENSION, type Project } from "../core/project/schema";

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
  | { type: "saved"; project: Project; filePath: string };

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
