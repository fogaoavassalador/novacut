import type { ProjectSettings } from "../project/schema";

export interface Resolution {
  width: number;
  height: number;
  label: string;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Resolução do projeto e reduções comuns (mesma proporção, dimensões pares). */
export function resolutionOptions(s: Pick<ProjectSettings, "width" | "height">): Resolution[] {
  const out: Resolution[] = [{ width: even(s.width), height: even(s.height), label: `Do projeto (${even(s.width)}×${even(s.height)})` }];
  const shortSide = Math.min(s.width, s.height);
  for (const target of [1080, 720, 480]) {
    if (target >= shortSide) continue;
    const k = target / shortSide;
    const w = even(s.width * k);
    const h = even(s.height * k);
    out.push({ width: w, height: h, label: `${w}×${h}` });
  }
  return out;
}

export type Quality = "alta" | "media" | "leve";
export const QUALITY_LABEL: Record<Quality, string> = { alta: "Alta", media: "Média", leve: "Leve" };
/** Taxa de bits de referência para 1920×1080, por qualidade. */
const BITRATE_1080P: Record<Quality, number> = { alta: 16_000_000, media: 10_000_000, leve: 5_000_000 };

/** Taxa de bits proporcional à área do quadro (mínimo de 1 Mb/s). */
export function videoBitrateFor(quality: Quality, width: number, height: number): number {
  const scaled = (BITRATE_1080P[quality] * width * height) / (1920 * 1080);
  return Math.max(1_000_000, Math.round(scaled / 100_000) * 100_000);
}

export const ENCODER_LABEL: Record<string, string> = {
  h264_amf: "GPU AMD (AMF)",
  h264_nvenc: "GPU NVIDIA (NVENC)",
  h264_qsv: "GPU Intel (Quick Sync)",
  h264_mf: "Windows Media Foundation",
  libopenh264: "OpenH264 (software)",
  libx264: "x264 (software)",
};

/** Tempo restante estimado (ms) a partir do tempo decorrido e da fração concluída. */
export function remainingMs(elapsedMs: number, fraction: number): number | null {
  if (fraction <= 0.02 || fraction >= 1) return null; // cedo demais para estimar
  return Math.round((elapsedMs / fraction) * (1 - fraction));
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}
