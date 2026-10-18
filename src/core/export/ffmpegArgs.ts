/**
 * Gera a linha de comando do FFmpeg que exporta o projeto para MP4.
 *
 * Mesmas regras da pré-visualização (core/preview/composition):
 * - camadas de vídeo de baixo (V1) para cima; faixas ocultas não entram;
 * - cada mídia é ajustada ("contain") e centralizada no quadro;
 * - brilho/contraste: out = clip((in·brilho − 0,5)·contraste + 0,5), via lutrgb;
 * - áudio de faixas não silenciadas, com volume e velocidade (atempo) do clipe.
 *
 * Cada clipe vira uma entrada própria com `-ss/-t` (busca rápida e precisa).
 * Os caminhos só aparecem em argumentos `-i`, nunca dentro do filtro: não há
 * escape de caminhos a fazer. O FFmpeg é executado sem shell.
 */
import { clipDurationUs, clipEndUs, projectDurationUs } from "../project/project";
import type { Clip, MediaRef, Project, Track } from "../project/schema";
import { type Micros, US_PER_SECOND } from "../time";

export const H264_ENCODERS = ["h264_amf", "h264_nvenc", "h264_qsv", "h264_mf", "libopenh264"] as const;
export type H264Encoder = (typeof H264_ENCODERS)[number];

export interface ExportOptions {
  outputPath: string;
  encoder: H264Encoder;
  /** Taxa de bits do vídeo, em bits/s. */
  videoBitrate: number;
  audioBitrate: number;
  /** Padrão: resolução do projeto. */
  width?: number;
  height?: number;
}

export interface ExportPlan {
  args: string[];
  durationUs: Micros;
  /** Número de clipes de vídeo e de áudio que entram na exportação. */
  videoLayers: number;
  audioSources: number;
}

/** Segundos com 6 casas (precisão de µs), sem notação exponencial. */
export function sec(us: Micros): string {
  return (us / US_PER_SECOND).toFixed(6);
}

/**
 * Cadeia de `atempo` para uma velocidade. Cada estágio aceita 0,5–100;
 * velocidades menores que 0,5 viram vários estágios de 0,5.
 */
export function atempoChain(speed: number): string[] {
  if (!(speed > 0)) throw new RangeError(`velocidade inválida: ${speed}`);
  if (speed === 1) return [];
  const stages: string[] = [];
  let rest = speed;
  while (rest < 0.5) {
    stages.push("atempo=0.5");
    rest /= 0.5;
  }
  stages.push(`atempo=${+rest.toFixed(6)}`);
  return stages;
}

/** Expressão do lutrgb equivalente ao CSS `brightness(b) contrast(c)`. */
export function lutExpr(brightness: number, contrast: number): string {
  // Usada entre aspas simples no filtro: as vírgulas não precisam de escape.
  return `clip(((val/maxval)*${brightness}-0.5)*${contrast}+0.5,0,1)*maxval`;
}

function colorHex(bg: string): string {
  return `0x${bg.replace("#", "")}`;
}

interface Placed {
  clip: Clip;
  media: MediaRef;
  track: Track;
  trackIndex: number;
}

function placedClips(project: Project): Placed[] {
  const media = new Map(project.media.map((m) => [m.id, m]));
  return project.tracks.flatMap((track, trackIndex) =>
    track.clips.flatMap((clip) => {
      const m = media.get(clip.mediaId);
      return m ? [{ clip, media: m, track, trackIndex }] : [];
    }),
  );
}

export function buildExportPlan(project: Project, opts: ExportOptions): ExportPlan {
  const durationUs = projectDurationUs(project);
  if (durationUs <= 0) throw new Error("a timeline está vazia");
  const W = opts.width ?? project.settings.width;
  const H = opts.height ?? project.settings.height;
  if (W % 2 || H % 2) throw new Error("largura e altura precisam ser pares para H.264");
  const fps = project.settings.fps;
  const sr = project.settings.sampleRate;
  const D = sec(durationUs);

  const all = placedClips(project);
  // Camadas: de V1 (último índice) para o topo; mesma regra de visualLayersAt.
  const visual = all
    .filter((p) => p.track.kind === "video" && !p.track.hidden && p.media.hasVideo)
    .sort((a, b) => b.trackIndex - a.trackIndex || a.clip.timelineStartUs - b.clip.timelineStartUs);
  const audible = all.filter((p) => !p.track.muted && p.media.hasAudio);

  const inputs: string[] = [];
  // Uma entrada por clipe; vídeo e áudio do mesmo clipe a compartilham.
  const inputIndex = new Map<string, number>();
  const inputFor = (p: Placed): number => {
    const existing = inputIndex.get(p.clip.id);
    if (existing !== undefined) return existing;
    const idx = inputIndex.size;
    inputIndex.set(p.clip.id, idx);
    if (p.media.kind === "image") {
      inputs.push("-loop", "1", "-framerate", String(fps), "-t", sec(clipDurationUs(p.clip)), "-i", p.media.path);
    } else {
      inputs.push("-ss", sec(p.clip.sourceInUs), "-t", sec(p.clip.sourceOutUs - p.clip.sourceInUs), "-i", p.media.path);
    }
    return idx;
  };

  const filters: string[] = [];
  filters.push(`color=c=${colorHex(project.settings.background)}:s=${W}x${H}:r=${fps}:d=${D}[base]`);

  let current = "base";
  visual.forEach((p, n) => {
    const i = inputFor(p);
    const start = sec(p.clip.timelineStartUs);
    const end = sec(clipEndUs(p.clip));
    const chain = [
      p.media.kind === "image" ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${p.clip.speed}`,
      `fps=${fps}`,
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    ];
    if (p.clip.brightness !== 1 || p.clip.contrast !== 1) {
      const e = lutExpr(p.clip.brightness, p.clip.contrast);
      chain.push("format=rgb24", `lutrgb=r='${e}':g='${e}':b='${e}'`);
    }
    chain.push("format=yuva420p", `setpts=PTS+${start}/TB`);
    filters.push(`[${i}:v]${chain.join(",")}[v${n}]`);
    const out = `o${n}`;
    filters.push(
      `[${current}][v${n}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${start},${end})'[${out}]`,
    );
    current = out;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);

  filters.push(`anullsrc=r=${sr}:cl=stereo,atrim=duration=${D}[asil]`);
  const mixInputs = ["[asil]"];
  audible.forEach((p, n) => {
    const i = inputFor(p);
    const delayMs = Math.round(p.clip.timelineStartUs / 1000);
    const chain = [
      "asetpts=PTS-STARTPTS",
      ...atempoChain(p.clip.speed),
      `volume=${p.clip.volume}`,
      `aformat=sample_fmts=fltp:sample_rates=${sr}:channel_layouts=stereo`,
      `adelay=${delayMs}|${delayMs}`,
    ];
    filters.push(`[${i}:a]${chain.join(",")}[a${n}]`);
    mixInputs.push(`[a${n}]`);
  });
  filters.push(
    mixInputs.length === 1
      ? `[asil]anull[aout]`
      : `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0,atrim=duration=${D}[aout]`,
  );

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    opts.encoder,
    "-b:v",
    String(opts.videoBitrate),
    "-c:a",
    "aac",
    "-b:a",
    String(opts.audioBitrate),
    "-r",
    String(fps),
    "-t",
    D,
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    opts.outputPath,
  ];
  return { args, durationUs, videoLayers: visual.length, audioSources: audible.length };
}
