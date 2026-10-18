import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { createEmptyProject } from "../core/project/project";
import type { MediaRef } from "../core/project/schema";
import {
  getStartupProjectPath,
  ProjectFileError,
  pickProjectSavePath,
  pickProjectToOpen,
  readProjectFile,
  writeProjectFile,
} from "../platform/projectFiles";
import {
  DEFAULT_PROJECT_NAME,
  documentReducer,
  initialDocument,
  prepareForSave,
  windowTitle,
  withProjectExtension,
} from "./document";

/** Evita abrir o projeto inicial duas vezes (StrictMode executa efeitos em dobro em dev). */
let startupHandled = false;

async function showError(title: string, e: unknown) {
  let text = e instanceof Error ? e.message : String(e);
  if (e instanceof ProjectFileError && e.issues.length) {
    const lines = e.issues.slice(0, 6).map((i) => `• ${i.path ? `${i.path}: ` : ""}${i.message}`);
    if (e.issues.length > 6) lines.push(`… e mais ${e.issues.length - 6} problema(s)`);
    text += `\n\n${lines.join("\n")}`;
  }
  await message(text, { title, kind: "error" });
}

export function useProjectDocument() {
  const [doc, dispatch] = useReducer(documentReducer, undefined, initialDocument);
  // Referência sempre atual para callbacks assíncronos e o handler de fechar janela.
  const docRef = useRef(doc);
  docRef.current = doc;

  const confirmDiscard = useCallback(async () => {
    if (!docRef.current.dirty) return true;
    return ask("Há alterações não salvas. Descartar e continuar?", {
      title: "NovaCut",
      kind: "warning",
      okLabel: "Descartar",
      cancelLabel: "Cancelar",
    });
  }, []);

  const saveTo = useCallback(async (path: string) => {
    const target = withProjectExtension(path);
    const project = prepareForSave(docRef.current.project, target);
    try {
      await writeProjectFile(target, project);
      dispatch({ type: "saved", project, filePath: target });
      return true;
    } catch (e) {
      await showError("Não foi possível salvar", e);
      return false;
    }
  }, []);

  const saveAs = useCallback(async () => {
    const path = await pickProjectSavePath(docRef.current.project.name);
    return path ? saveTo(path) : false;
  }, [saveTo]);

  const saveProject = useCallback(async () => {
    const path = docRef.current.filePath;
    return path ? saveTo(path) : saveAs();
  }, [saveTo, saveAs]);

  const newProject = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    dispatch({ type: "new", project: createEmptyProject(DEFAULT_PROJECT_NAME) });
  }, [confirmDiscard]);

  const openProject = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const path = await pickProjectToOpen();
    if (!path) return;
    try {
      dispatch({ type: "loaded", project: await readProjectFile(path), filePath: path });
    } catch (e) {
      await showError("Não foi possível abrir o projeto", e);
    }
  }, [confirmDiscard]);

  const rename = useCallback((name: string) => dispatch({ type: "rename", name }), []);
  const addMedia = useCallback((media: MediaRef[]) => dispatch({ type: "addMedia", media }), []);
  const removeMedia = useCallback((mediaId: string) => dispatch({ type: "removeMedia", mediaId }), []);
  const getProject = useCallback(() => docRef.current.project, []);

  // Abre o projeto passado na linha de comando, uma única vez por execução.
  useEffect(() => {
    if (startupHandled) return;
    startupHandled = true;
    getStartupProjectPath()
      .then(async (path) => {
        if (path) dispatch({ type: "loaded", project: await readProjectFile(path), filePath: path });
      })
      .catch((e) => showError("Não foi possível abrir o projeto", e));
  }, []);

  // Título da janela reflete nome e alterações pendentes.
  useEffect(() => {
    getCurrentWindow().setTitle(windowTitle(doc)).catch(() => {});
  }, [doc]);

  // Pergunta antes de fechar a janela com alterações pendentes.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await confirmDiscard())) event.preventDefault();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [confirmDiscard]);

  // Atalhos: Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const run =
        key === "n" ? newProject : key === "o" ? openProject : key === "s" ? (e.shiftKey ? saveAs : saveProject) : null;
      if (!run) return;
      e.preventDefault();
      void run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newProject, openProject, saveAs, saveProject]);

  return { doc, newProject, openProject, saveProject, saveAs, rename, addMedia, removeMedia, getProject };
}
