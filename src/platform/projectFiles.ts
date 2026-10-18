import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { checkInvariants, type ProjectIssue } from "../core/project/project";
import { PROJECT_EXTENSION, type Project } from "../core/project/schema";
import { parseProject, serializeProject } from "../core/project/serialize";

const FILTERS = [{ name: "Projeto NovaCut", extensions: [PROJECT_EXTENSION] }];

export async function pickProjectToOpen(): Promise<string | null> {
  const picked = await open({ multiple: false, directory: false, filters: FILTERS });
  return typeof picked === "string" ? picked : null;
}

export async function pickProjectSavePath(suggestedName: string): Promise<string | null> {
  return save({ filters: FILTERS, defaultPath: `${suggestedName}.${PROJECT_EXTENSION}` });
}

export class ProjectFileError extends Error {
  constructor(
    message: string,
    readonly issues: ProjectIssue[] = [],
  ) {
    super(message);
  }
}

export async function readProjectFile(path: string): Promise<Project> {
  const text = await invoke<string>("load_project", { path });
  const result = parseProject(text);
  if (!result.ok) throw new ProjectFileError("O arquivo não é um projeto NovaCut válido.", result.issues);
  return result.project;
}

/** Recusa gravar um projeto inconsistente: um bug não pode virar arquivo corrompido. */
export async function writeProjectFile(path: string, project: Project): Promise<void> {
  const issues = checkInvariants(project);
  if (issues.length) throw new ProjectFileError("O projeto está inconsistente e não foi salvo.", issues);
  await invoke("save_project", { path, contents: serializeProject(project) });
}
