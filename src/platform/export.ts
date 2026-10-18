import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";

export interface ExportProgressEvent {
  jobId: string;
  outTimeUs: number;
  speed: number | null;
  done: boolean;
}

export interface ExportDoneEvent {
  jobId: string;
  ok: boolean;
  cancelled: boolean;
  error: string | null;
  outputPath: string;
}

export const workingEncoders = () => invoke<string[]>("export_encoders");

export const startExport = (jobId: string, args: string[], outputPath: string) =>
  invoke<void>("export_start", { jobId, args, outputPath });

export const cancelExport = (jobId: string) => invoke<void>("export_cancel", { jobId });

export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });

export function onExportProgress(cb: (e: ExportProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ExportProgressEvent>("export-progress", (e) => cb(e.payload));
}

export function onExportDone(cb: (e: ExportDoneEvent) => void): Promise<UnlistenFn> {
  return listen<ExportDoneEvent>("export-done", (e) => cb(e.payload));
}

export function pickExportPath(defaultPath: string): Promise<string | null> {
  return save({ defaultPath, filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }] });
}
