/**
 * Geometria da timeline: conversão pixel ↔ tempo, zoom e snapping.
 * Tudo puro, para ser testado sem DOM.
 */
import { clipEndUs } from "../project/project";
import type { Project } from "../project/schema";
import { type Micros, US_PER_SECOND } from "../time";

export const MIN_PX_PER_SECOND = 2;
export const MAX_PX_PER_SECOND = 800;
/** Distância, em pixels, abaixo da qual uma borda "gruda" num ponto de encaixe. */
export const SNAP_PX = 8;

export function usToPx(us: Micros, pxPerSecond: number): number {
  return (us / US_PER_SECOND) * pxPerSecond;
}

export function pxToUs(px: number, pxPerSecond: number): Micros {
  return Math.round((px / pxPerSecond) * US_PER_SECOND);
}

export function clampZoom(pxPerSecond: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/**
 * Novo zoom e nova rolagem para que o instante sob o ponteiro continue sob o
 * ponteiro. `pointerX` é relativo à borda esquerda visível da área de faixas.
 */
export function zoomAround(
  pxPerSecond: number,
  factor: number,
  scrollLeft: number,
  pointerX: number,
): { pxPerSecond: number; scrollLeft: number } {
  const next = clampZoom(pxPerSecond * factor);
  const timeAtPointer = (scrollLeft + pointerX) / pxPerSecond; // segundos
  return { pxPerSecond: next, scrollLeft: Math.max(0, timeAtPointer * next - pointerX) };
}

/** Zoom que faz `durationUs` caber em `widthPx` (com uma pequena margem). */
export function zoomToFit(durationUs: Micros, widthPx: number): number {
  if (durationUs <= 0 || widthPx <= 0) return 60;
  return clampZoom((widthPx * 0.95) / (durationUs / US_PER_SECOND));
}

/** Pontos de encaixe: 0, playhead e bordas de todos os clipes (exceto os ignorados). */
export function snapPoints(project: Project, playheadUs: Micros, ignoreClipIds: ReadonlySet<string> = new Set()): Micros[] {
  const pts = new Set<Micros>([0, playheadUs]);
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (ignoreClipIds.has(c.id)) continue;
      pts.add(c.timelineStartUs);
      pts.add(clipEndUs(c));
    }
  return [...pts].sort((a, b) => a - b);
}

/** Ponto de encaixe mais próximo de `us` dentro do limite, ou `null`. */
export function nearestSnap(us: Micros, points: readonly Micros[], thresholdUs: Micros): Micros | null {
  let best: Micros | null = null;
  for (const p of points) {
    const d = Math.abs(p - us);
    if (d <= thresholdUs && (best === null || d < Math.abs(best - us))) best = p;
  }
  return best;
}

/**
 * Encaixe de um clipe sendo movido: tenta encaixar a borda inicial ou a final
 * (a mais próxima vence). Devolve o novo início e o ponto usado (para a guia).
 */
export function snapMove(
  startUs: Micros,
  durationUs: Micros,
  points: readonly Micros[],
  thresholdUs: Micros,
): { startUs: Micros; snappedAt: Micros | null } {
  const byStart = nearestSnap(startUs, points, thresholdUs);
  const byEnd = nearestSnap(startUs + durationUs, points, thresholdUs);
  const dStart = byStart === null ? Infinity : Math.abs(byStart - startUs);
  const dEnd = byEnd === null ? Infinity : Math.abs(byEnd - (startUs + durationUs));
  if (dStart === Infinity && dEnd === Infinity) return { startUs: Math.max(0, startUs), snappedAt: null };
  if (dStart <= dEnd) return { startUs: Math.max(0, byStart!), snappedAt: byStart };
  return { startUs: Math.max(0, byEnd! - durationUs), snappedAt: byEnd };
}

/** Índice da faixa sob a coordenada vertical `y` (relativa ao topo das faixas). */
export function trackIndexAtY(y: number, trackHeightPx: number, trackCount: number): number | null {
  if (y < 0) return null;
  const i = Math.floor(y / trackHeightPx);
  return i < trackCount ? i : null;
}
