import { invoke } from "@tauri-apps/api/core";

/** Espelha `ffmpeg::FfmpegStatus` em src-tauri/src/ffmpeg.rs. */
export interface FfmpegStatus {
  found: boolean;
  /** "env" = NOVACUT_FFMPEG_DIR · "bundled" = embutido no app · "path" = PATH do sistema. */
  source: "env" | "bundled" | "path" | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  license: string | null;
  /** Encoders H.264 compilados no binário (não garante hardware presente). */
  h264Encoders: string[];
  error: string | null;
}

export function getFfmpegStatus(): Promise<FfmpegStatus> {
  return invoke<FfmpegStatus>("ffmpeg_status");
}
