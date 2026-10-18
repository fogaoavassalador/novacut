/**
 * O que está na tela (e no alto-falante) num instante da timeline.
 * Puro e compartilhado: a pré-visualização usa estas regras, e a exportação
 * deve seguir exatamente as mesmas.
 */
import { clipEndUs } from "../project/project";
import type { Clip, MediaRef, Project, Track } from "../project/schema";
import type { Micros } from "../time";

export interface ActiveClip {
  clip: Clip;
  media: MediaRef;
  track: Track;
  trackIndex: number;
  /** Posição correspondente dentro da mídia, em µs (considerando a velocidade). */
  sourceUs: Micros;
}

/** Instante da mídia que corresponde ao instante `t` da timeline. */
export function sourceTimeAt(clip: Clip, t: Micros): Micros {
  return Math.round(clip.sourceInUs + (t - clip.timelineStartUs) * clip.speed);
}

function collect(project: Project, include: (c: Clip) => boolean, at: Micros): ActiveClip[] {
  const media = new Map(project.media.map((m) => [m.id, m]));
  const out: ActiveClip[] = [];
  project.tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) {
      const m = media.get(clip.mediaId);
      if (m && include(clip)) out.push({ clip, media: m, track, trackIndex, sourceUs: sourceTimeAt(clip, at) });
    }
  });
  return out;
}

/** Clipes ativos em `t` (intervalo [início, fim) ), de todas as faixas. */
export function activeClipsAt(project: Project, t: Micros): ActiveClip[] {
  return collect(project, (c) => c.timelineStartUs <= t && t < clipEndUs(c), t);
}

/**
 * Camadas de imagem em `t`, de baixo para cima: faixas de vídeo visíveis,
 * da última (V1, mais baixa) para a primeira (topo).
 */
export function visualLayersAt(project: Project, t: Micros): ActiveClip[] {
  return activeClipsAt(project, t)
    .filter((a) => a.track.kind === "video" && !a.track.hidden && a.media.hasVideo)
    .sort((a, b) => b.trackIndex - a.trackIndex);
}

/** Fontes de som em `t`: áudio de clipes em faixas não silenciadas. */
export function audioSourcesAt(project: Project, t: Micros): ActiveClip[] {
  return activeClipsAt(project, t).filter((a) => !a.track.muted && a.media.hasAudio);
}

/**
 * Clipes que precisam de elemento montado: ativos agora ou começando em até
 * `lookaheadUs` (para pré-carregar e trocar de clipe sem engasgo).
 */
export function clipsToMount(project: Project, t: Micros, lookaheadUs: Micros): ActiveClip[] {
  return collect(project, (c) => c.timelineStartUs <= t + lookaheadUs && t < clipEndUs(c), t);
}

/**
 * Filtro CSS equivalente aos ajustes do clipe. A exportação usa a mesma
 * fórmula com `lutrgb`: out = clip((in·brilho − 0,5)·contraste + 0,5).
 */
export function cssFilter(clip: Pick<Clip, "brightness" | "contrast">): string {
  if (clip.brightness === 1 && clip.contrast === 1) return "none";
  return `brightness(${clip.brightness}) contrast(${clip.contrast})`;
}

/** Tolerância de dessincronia antes de forçar um seek durante a reprodução. */
export const DRIFT_TOLERANCE_US = 120_000;

/**
 * Decide se o elemento de mídia precisa de seek. Parado: qualquer diferença
 * acima de meio quadro. Tocando: só acima da tolerância (seeks custam caro).
 */
export function needsSeek(actualUs: Micros, expectedUs: Micros, playing: boolean, frameUs: Micros): boolean {
  const drift = Math.abs(actualUs - expectedUs);
  return playing ? drift > DRIFT_TOLERANCE_US : drift > frameUs / 2;
}

export interface ElementPlan {
  /** O elemento deve estar tocando. */
  play: boolean;
  /** Posição (µs na mídia) para onde fazer seek, ou `null` se já está bem. */
  seekToUs: Micros | null;
}

/**
 * O que fazer com o elemento de mídia de um clipe montado.
 * - ativo e tocando: tocar, corrigindo só dessincronia grande;
 * - ativo e parado: pausar no quadro exato;
 * - montado só para pré-carregar: pausar já posicionado no início do trecho.
 */
export function planElement(p: {
  clip: Clip;
  t: Micros;
  active: boolean;
  playing: boolean;
  actualUs: Micros;
  frameUs: Micros;
}): ElementPlan {
  const expected = p.active ? sourceTimeAt(p.clip, p.t) : p.clip.sourceInUs;
  const play = p.active && p.playing;
  return { play, seekToUs: needsSeek(p.actualUs, expected, play, p.frameUs) ? expected : null };
}
