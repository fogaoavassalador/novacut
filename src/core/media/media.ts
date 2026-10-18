import type { MediaKind, MediaRef, Project } from "../project/schema";
import type { Micros } from "../time";

/** Resultado do comando `probe_media` (espelha `media::MediaProbe` em Rust). */
export interface MediaProbe {
  kind: MediaKind;
  durationUs: Micros | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  rotation: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  container: string;
}

/** Extensões oferecidas no diálogo de importação. A decisão final é sempre do ffprobe. */
export const IMPORT_EXTENSIONS = {
  video: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "gif"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"],
  image: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"],
} as const;

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Chave de comparação de caminhos: no Windows, sem diferença de caixa nem de barra. */
export function pathKey(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

export function mediaRefFromProbe(probe: MediaProbe, path: string, id: string): MediaRef {
  return {
    id,
    kind: probe.kind,
    path,
    name: fileName(path),
    durationUs: probe.kind === "image" ? null : probe.durationUs,
    width: probe.width,
    height: probe.height,
    fps: probe.kind === "video" ? probe.fps : null,
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
  };
}

/**
 * Instante usado na miniatura: 1 s ou 10% da duração (o que for menor), para
 * fugir de quadros pretos de abertura. `null` = mídia sem imagem (áudio).
 */
export function thumbnailTimeUs(media: MediaRef): Micros | null {
  if (media.kind === "audio") return null;
  if (media.kind === "image" || media.durationUs === null) return 0;
  return Math.min(1_000_000, Math.floor(media.durationUs * 0.1));
}

export function findMediaByPath(project: Project, path: string): MediaRef | undefined {
  const key = pathKey(path);
  return project.media.find((m) => pathKey(m.path) === key);
}

export function isMediaInUse(project: Project, mediaId: string): boolean {
  return project.tracks.some((t) => t.clips.some((c) => c.mediaId === mediaId));
}
