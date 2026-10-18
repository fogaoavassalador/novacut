import { clipEndUs } from "../project/project";
import type { Clip, Project } from "../project/schema";
import type { Micros } from "../time";
import { minClipDurationUs } from "./ops";

/** Clipes que podem ser divididos em `atUs` (o ponto fica a ≥ 1 quadro das bordas). */
export function clipsSplittableAt(project: Project, atUs: Micros): Clip[] {
  const min = minClipDurationUs(project);
  return project.tracks.flatMap((t) =>
    t.clips.filter((c) => atUs - c.timelineStartUs >= min && clipEndUs(c) - atUs >= min),
  );
}

/**
 * Alvos da divisão no playhead: os clipes selecionados sob o playhead; se
 * nenhum selecionado estiver sob ele, todos os clipes sob o playhead.
 */
export function splitTargets(project: Project, selected: ReadonlySet<string>, playheadUs: Micros): Clip[] {
  const under = clipsSplittableAt(project, playheadUs);
  const chosen = under.filter((c) => selected.has(c.id));
  return chosen.length ? chosen : under;
}

/** Remove da seleção os clipes que não existem mais (após desfazer, excluir…). */
export function pruneSelection(project: Project, selected: ReadonlySet<string>): ReadonlySet<string> {
  const existing = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = [...selected].filter((id) => existing.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

/** Clique simples seleciona só o clipe; com Ctrl/Shift alterna o clipe na seleção. */
export function nextSelection(selected: ReadonlySet<string>, clipId: string, additive: boolean): ReadonlySet<string> {
  if (!additive) return selected.size === 1 && selected.has(clipId) ? selected : new Set([clipId]);
  const next = new Set(selected);
  if (next.has(clipId)) next.delete(clipId);
  else next.add(clipId);
  return next;
}
