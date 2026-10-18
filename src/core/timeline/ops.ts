/**
 * Operações de edição da timeline. Todas são puras: recebem um projeto e
 * devolvem um projeto novo (sem mutar o original) ou um erro explicativo.
 * Nenhuma operação produz um projeto que viole `checkInvariants`.
 */
import { clipDurationUs, clipEndUs, mediaFitsTrack } from "../project/project";
import type { Clip, MediaRef, Project, Track } from "../project/schema";
import { type Micros, US_PER_SECOND } from "../time";

export type OpResult = { ok: true; project: Project } | { ok: false; error: string };

/** Duração padrão de uma imagem ao entrar na timeline. */
export const DEFAULT_IMAGE_DURATION_US = 5 * US_PER_SECOND;

const ok = (project: Project): OpResult => ({ ok: true, project });
const fail = (error: string): OpResult => ({ ok: false, error });

/** Menor duração de clipe permitida: um quadro na taxa do projeto. */
export function minClipDurationUs(project: Project): Micros {
  return Math.ceil(US_PER_SECOND / project.settings.fps);
}

interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
}

export function findClip(project: Project, clipId: string): ClipLocation | undefined {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex++) {
    const track = project.tracks[trackIndex];
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, trackIndex, clip };
  }
  return undefined;
}

function mediaById(project: Project, id: string): MediaRef | undefined {
  return project.media.find((m) => m.id === id);
}

/** Substitui uma faixa mantendo os clipes ordenados por início. */
function withTrack(project: Project, track: Track): Project {
  const sorted = { ...track, clips: [...track.clips].sort((a, b) => a.timelineStartUs - b.timelineStartUs) };
  return { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? sorted : t)) };
}

/** Algum clipe da faixa (exceto `ignoreId`) ocupa parte de [start, end)? */
export function rangeIsFree(track: Track, start: Micros, end: Micros, ignoreId?: string): boolean {
  return track.clips.every(
    (c) => c.id === ignoreId || clipEndUs(c) <= start || c.timelineStartUs >= end,
  );
}

export function trackEndUs(track: Track): Micros {
  return track.clips.reduce((end, c) => Math.max(end, clipEndUs(c)), 0);
}

/**
 * Faixa padrão para uma mídia: a faixa de vídeo mais baixa (mais perto de V1)
 * para vídeo/imagem; a primeira faixa de áudio para áudio.
 */
export function defaultTrackFor(project: Project, media: MediaRef): Track | undefined {
  const fits = project.tracks.filter((t) => mediaFitsTrack(media, t) && (media.kind === "audio") === (t.kind === "audio"));
  return media.kind === "audio" ? fits[0] : fits[fits.length - 1];
}

export interface AddClipParams {
  clipId: string;
  mediaId: string;
  /** Padrão: faixa sugerida por `defaultTrackFor`. */
  trackId?: string;
  /** Padrão: fim da faixa. */
  startUs?: Micros;
  /** Padrão: mídia inteira (imagens: `DEFAULT_IMAGE_DURATION_US`). */
  sourceInUs?: Micros;
  sourceOutUs?: Micros;
}

export function addClip(project: Project, p: AddClipParams): OpResult {
  const media = mediaById(project, p.mediaId);
  if (!media) return fail("mídia não encontrada");
  const track = p.trackId ? project.tracks.find((t) => t.id === p.trackId) : defaultTrackFor(project, media);
  if (!track) return fail(p.trackId ? "faixa não encontrada" : "nenhuma faixa compatível com esta mídia");
  if (!mediaFitsTrack(media, track)) return fail(`mídia do tipo ${media.kind} não cabe em faixa de ${track.kind}`);
  if (findClip(project, p.clipId)) return fail("id de clipe já existe");

  const sourceIn = p.sourceInUs ?? 0;
  const sourceOut = p.sourceOutUs ?? media.durationUs ?? DEFAULT_IMAGE_DURATION_US;
  if (sourceIn < 0 || sourceOut - sourceIn < minClipDurationUs(project)) return fail("trecho da mídia curto demais");
  if (media.durationUs !== null && sourceOut > media.durationUs) return fail("trecho além da duração da mídia");

  const clip: Clip = {
    id: p.clipId,
    mediaId: media.id,
    timelineStartUs: Math.max(0, Math.round(p.startUs ?? trackEndUs(track))),
    sourceInUs: sourceIn,
    sourceOutUs: sourceOut,
    speed: 1,
    volume: 1,
    brightness: 1,
    contrast: 1,
  };
  if (!rangeIsFree(track, clip.timelineStartUs, clipEndUs(clip))) return fail("o espaço na faixa já está ocupado");
  return ok(withTrack(project, { ...track, clips: [...track.clips, clip] }));
}

export function moveClip(project: Project, clipId: string, to: { trackId?: string; startUs: Micros }): OpResult {
  const loc = findClip(project, clipId);
  if (!loc) return fail("clipe não encontrado");
  const target = to.trackId ? project.tracks.find((t) => t.id === to.trackId) : loc.track;
  if (!target) return fail("faixa não encontrada");
  const media = mediaById(project, loc.clip.mediaId);
  if (!media || !mediaFitsTrack(media, target)) return fail(`este clipe não cabe em faixa de ${target.kind}`);

  const moved: Clip = { ...loc.clip, timelineStartUs: Math.max(0, Math.round(to.startUs)) };
  if (!rangeIsFree(target, moved.timelineStartUs, clipEndUs(moved), clipId))
    return fail("o espaço na faixa já está ocupado");

  if (target.id === loc.track.id)
    return ok(withTrack(project, { ...target, clips: target.clips.map((c) => (c.id === clipId ? moved : c)) }));
  const fromRemoved = withTrack(project, { ...loc.track, clips: loc.track.clips.filter((c) => c.id !== clipId) });
  const targetNow = fromRemoved.tracks.find((t) => t.id === target.id)!;
  return ok(withTrack(fromRemoved, { ...targetNow, clips: [...targetNow.clips, moved] }));
}

/**
 * Corta uma borda do clipe para o instante `atUs` da timeline, sem empurrar
 * outros clipes. O valor é limitado (e não recusado) pelos vizinhos, pelo
 * início/fim da mídia e pela duração mínima, para acompanhar um arraste.
 */
export function trimClip(project: Project, clipId: string, edge: "start" | "end", atUs: Micros): OpResult {
  const loc = findClip(project, clipId);
  if (!loc) return fail("clipe não encontrado");
  const { clip, track } = loc;
  const media = mediaById(project, clip.mediaId);
  if (!media) return fail("mídia não encontrada");
  const min = minClipDurationUs(project);
  const s = clip.speed;
  const others = track.clips.filter((c) => c.id !== clipId);
  let updated: Clip;

  if (edge === "start") {
    const prevEnd = others
      .filter((c) => c.timelineStartUs < clip.timelineStartUs)
      .reduce((e, c) => Math.max(e, clipEndUs(c)), 0);
    // O fim fica fixo; sourceIn é derivado dele com floor, para que o fim
    // recalculado nunca avance (nem encoste num vizinho) por arredondamento.
    const end = clipEndUs(clip);
    const earliest = Math.max(prevEnd, end - Math.floor(clip.sourceOutUs / s)); // sourceIn ≥ 0
    const start = clamp(Math.round(atUs), earliest, end - min);
    const sourceIn = Math.max(0, clip.sourceOutUs - Math.floor((end - start) * s));
    updated = { ...clip, timelineStartUs: start, sourceInUs: sourceIn };
  } else {
    const nextStart = others
      .filter((c) => c.timelineStartUs >= clip.timelineStartUs)
      .reduce((n, c) => Math.min(n, c.timelineStartUs), Number.POSITIVE_INFINITY);
    const mediaLimit =
      media.durationUs === null ? Number.POSITIVE_INFINITY : clip.timelineStartUs + Math.floor((media.durationUs - clip.sourceInUs) / s);
    const end = clamp(Math.round(atUs), clip.timelineStartUs + min, Math.min(nextStart, mediaLimit));
    // floor garante que o fim recalculado nunca ultrapasse `end` (nem o vizinho).
    let sourceOut = clip.sourceInUs + Math.floor((end - clip.timelineStartUs) * s);
    if (media.durationUs !== null) sourceOut = Math.min(sourceOut, media.durationUs);
    updated = { ...clip, sourceOutUs: sourceOut };
  }

  // Tolerância de 1 µs: o floor acima pode encurtar o clipe em até 1 µs.
  if (clipDurationUs(updated) < min - 1) return fail("o clipe ficaria curto demais");
  return ok(withTrack(project, { ...track, clips: track.clips.map((c) => (c.id === clipId ? updated : c)) }));
}

/** Divide um clipe em dois no instante `atUs`; o novo clipe (à direita) recebe `newClipId`. */
export function splitClip(project: Project, clipId: string, atUs: Micros, newClipId: string): OpResult {
  const loc = findClip(project, clipId);
  if (!loc) return fail("clipe não encontrado");
  if (findClip(project, newClipId)) return fail("id de clipe já existe");
  const { clip, track } = loc;
  const at = Math.round(atUs);
  const end = clipEndUs(clip);
  const min = minClipDurationUs(project);
  if (at - clip.timelineStartUs < min || end - at < min) return fail("o ponto de divisão está fora do clipe ou perto demais de uma borda");

  const s = clip.speed;
  const splitSource = clip.sourceInUs + Math.round((at - clip.timelineStartUs) * s);
  const left: Clip = { ...clip, sourceOutUs: splitSource };
  // O fim da parte direita não pode passar do fim original (arredondamento com velocidade ≠ 1).
  const right: Clip = {
    ...clip,
    id: newClipId,
    timelineStartUs: at,
    sourceInUs: splitSource,
    sourceOutUs: Math.min(clip.sourceOutUs, splitSource + Math.floor((end - at) * s)),
  };
  if (clipEndUs(left) > at) left.sourceOutUs = clip.sourceInUs + Math.floor((at - clip.timelineStartUs) * s);
  return ok(withTrack(project, { ...track, clips: [...track.clips.map((c) => (c.id === clipId ? left : c)), right] }));
}

/** Propriedades ajustáveis no painel, com os limites aceitos pelo app. */
export type ClipProps = Pick<Clip, "volume" | "speed" | "brightness" | "contrast">;
export const PROP_LIMITS: Record<keyof ClipProps, { min: number; max: number }> = {
  volume: { min: 0, max: 4 },
  speed: { min: 0.1, max: 16 },
  brightness: { min: 0, max: 2 },
  contrast: { min: 0, max: 2 },
};

/**
 * Altera propriedades de um ou mais clipes. Mudar a velocidade muda a duração
 * na timeline (o trecho da mídia é o mesmo); se o clipe mais lento invadir o
 * vizinho, a operação é recusada em vez de empurrar outros clipes.
 */
export function setClipProps(project: Project, clipIds: readonly string[], props: Partial<ClipProps>): OpResult {
  if (!clipIds.length) return fail("nenhum clipe selecionado");
  for (const [k, v] of Object.entries(props) as [keyof ClipProps, number][]) {
    const lim = PROP_LIMITS[k];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) return fail(`valor inválido para ${k}: ${v}`);
  }
  const ids = new Set(clipIds);
  if (![...ids].every((id) => findClip(project, id))) return fail("clipe não encontrado");

  const next = {
    ...project,
    tracks: project.tracks.map((t) => {
      if (!t.clips.some((c) => ids.has(c.id))) return t;
      return { ...t, clips: t.clips.map((c) => (ids.has(c.id) ? { ...c, ...props } : c)) };
    }),
  };
  if ("speed" in props) {
    const min = minClipDurationUs(project);
    for (const t of next.tracks)
      for (const c of t.clips) {
        if (!ids.has(c.id)) continue;
        if (clipDurationUs(c) < min) return fail("nessa velocidade o clipe ficaria menor que um quadro");
        if (!rangeIsFree(t, c.timelineStartUs, clipEndUs(c), c.id))
          return fail("não há espaço na faixa para o clipe mais lento; abra espaço depois dele");
      }
  }
  return ok(next);
}

export function deleteClips(project: Project, clipIds: readonly string[]): OpResult {
  const ids = new Set(clipIds);
  if (!clipIds.some((id) => findClip(project, id))) return fail("nenhum clipe encontrado");
  return ok({ ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) })) });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
