import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clipDurationUs, clipEndUs, newId, projectDurationUs } from "../core/project/project";
import type { MediaRef, Project } from "../core/project/schema";
import { formatTimecode, frameDurationMicros, type Micros, snapToFrame, US_PER_SECOND } from "../core/time";
import { findClip, moveClip, trimClip } from "../core/timeline/ops";
import { rulerTicks } from "../core/timeline/ruler";
import { nextSelection, splitTargets } from "../core/timeline/selection";
import {
  nearestSnap,
  pxToUs,
  SNAP_PX,
  snapMove,
  snapPoints,
  trackIndexAtY,
  usToPx,
  zoomAround,
  zoomToFit,
} from "../core/timeline/view";
import type { EditAction } from "../state/document";
import { isFormControl } from "./keyboard";

const TRACK_HEIGHT = 52;
const RULER_HEIGHT = 28;
/** Movimento mínimo (px) para um clique virar arraste. */
const DRAG_THRESHOLD = 3;
/** Largura da área sensível de corte em cada borda do clipe. */
const EDGE_PX = 7;
/** Espaço livre exibido depois do último clipe. */
const TAIL_US = 30 * US_PER_SECOND;

interface TimelineProps {
  project: Project;
  selected: ReadonlySet<string>;
  onSelect: (selected: ReadonlySet<string>) => void;
  playheadUs: Micros;
  onPlayhead: (us: Micros) => void;
  onEdit: (action: EditAction) => void;
  /** Durante a reprodução, rola a timeline para manter o playhead visível. */
  following?: boolean;
  /** Desliga os atalhos da timeline (ex.: com um diálogo aberto). */
  keyboardDisabled?: boolean;
}

type DragMode = "move" | "trim-start" | "trim-end";

interface DragState {
  mode: DragMode;
  clipId: string;
  originX: number;
  originY: number;
  origStartUs: Micros;
  origEdgeUs: Micros;
  durationUs: Micros;
  origTrackIndex: number;
  active: boolean;
  // Resultado atual do arraste:
  startUs: Micros;
  trackIndex: number;
  edgeUs: Micros;
  snappedAt: Micros | null;
  valid: boolean;
  /** Para cortes: o projeto já com o corte aplicado (pré-visualização). */
  preview: Project | null;
}

export function Timeline({
  project,
  selected,
  onSelect,
  playheadUs,
  onPlayhead,
  onEdit,
  following,
  keyboardDisabled,
}: TimelineProps) {
  const { tracks, media, settings } = project;
  const fps = settings.fps;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [pxPerSecond, setPxPerSecond] = useState(60);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  // A referência é atualizada junto com o estado, nos próprios eventos: se a
  // renderização atrasar (app ocupado), movimentos e o soltar não se perdem.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const durationUs = projectDurationUs(project);
  const contentWidth = Math.max(viewportWidth, usToPx(durationUs + TAIL_US, pxPerSecond));
  const mediaById = new Map<string, MediaRef>(media.map((m) => [m.id, m]));

  // ---------- rolagem e zoom ----------
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewportWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scrollerRef.current) {
      scrollerRef.current.scrollLeft = pendingScroll.current;
      setScrollLeft(scrollerRef.current.scrollLeft);
      pendingScroll.current = null;
    }
  }, [pxPerSecond]);

  const zoomBy = useCallback(
    (factor: number, pointerX?: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const anchor = pointerX ?? el.clientWidth / 2;
      const z = zoomAround(pxPerSecond, factor, el.scrollLeft, anchor);
      pendingScroll.current = z.scrollLeft;
      setPxPerSecond(z.pxPerSecond);
    },
    [pxPerSecond],
  );

  const zoomFit = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pendingScroll.current = 0;
    setPxPerSecond(zoomToFit(durationUs, el.clientWidth));
  }, [durationUs]);

  // Ctrl+roda = zoom no ponteiro; roda sem Ctrl = rolagem horizontal.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - el.getBoundingClientRect().left);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Página a timeline quando o playhead sai da área visível durante a reprodução.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!following || !el) return;
    const x = usToPx(playheadUs, pxPerSecond);
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - 24);
  }, [following, playheadUs, pxPerSecond]);

  // ---------- playhead ----------
  const timeAtClientX = (clientX: number) => {
    const rect = scrollerRef.current!.getBoundingClientRect();
    return pxToUs(clientX - rect.left + scrollerRef.current!.scrollLeft, pxPerSecond);
  };
  const setPlayheadFromX = (clientX: number) => onPlayhead(Math.max(0, snapToFrame(timeAtClientX(clientX), fps)));

  const onRulerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlayheadFromX(e.clientX);
  };
  const onRulerPointerMove = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setPlayheadFromX(e.clientX);
  };

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return; // só área vazia da faixa
    onSelect(new Set());
    setPlayheadFromX(e.clientX);
  };

  // ---------- arrastar / cortar clipes ----------
  const onClipPointerDown = (e: React.PointerEvent, clipId: string, trackIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.ctrlKey || e.shiftKey;
    onSelect(nextSelection(additive ? selected : new Set(), clipId, additive));
    if (additive) return;

    const loc = findClip(project, clipId)!;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const mode: DragMode =
      rect.width > EDGE_PX * 3 && x <= EDGE_PX ? "trim-start" : rect.width > EDGE_PX * 3 && x >= rect.width - EDGE_PX ? "trim-end" : "move";
    const start = loc.clip.timelineStartUs;
    const end = clipEndUs(loc.clip);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      mode,
      clipId,
      originX: e.clientX,
      originY: e.clientY,
      origStartUs: start,
      origEdgeUs: mode === "trim-end" ? end : start,
      durationUs: end - start,
      origTrackIndex: trackIndex,
      active: false,
      startUs: start,
      trackIndex,
      edgeUs: mode === "trim-end" ? end : start,
      snappedAt: null,
      valid: true,
      preview: null,
    });
  };

  const onClipPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const dy = e.clientY - d.originY;
    if (!d.active && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    const threshold = pxToUs(SNAP_PX, pxPerSecond);
    const points = snapPoints(project, playheadUs, new Set([d.clipId]));

    if (d.mode === "move") {
      const lanesTop = lanesRef.current!.getBoundingClientRect().top;
      const trackIndex = trackIndexAtY(e.clientY - lanesTop, TRACK_HEIGHT, tracks.length) ?? d.trackIndex;
      const snapped = snapMove(d.origStartUs + pxToUs(dx, pxPerSecond), d.durationUs, points, threshold);
      const valid = moveClip(project, d.clipId, { trackId: tracks[trackIndex].id, startUs: snapped.startUs }).ok;
      setDrag({ ...d, active: true, startUs: snapped.startUs, trackIndex, snappedAt: snapped.snappedAt, valid });
    } else {
      const raw = d.origEdgeUs + pxToUs(dx, pxPerSecond);
      const snapAt = nearestSnap(raw, points, threshold);
      const at = snapAt ?? raw;
      const r = trimClip(project, d.clipId, d.mode === "trim-start" ? "start" : "end", at);
      setDrag({ ...d, active: true, edgeUs: at, snappedAt: snapAt, valid: r.ok, preview: r.ok ? r.project : null });
    }
  };

  const finishDrag = (commit: boolean) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d || !d.active || !commit) return;
    if (d.mode === "move") {
      const trackId = tracks[d.trackIndex].id;
      if (d.valid && (d.startUs !== d.origStartUs || d.trackIndex !== d.origTrackIndex))
        onEdit({ type: "moveClip", clipId: d.clipId, trackId, startUs: d.startUs });
    } else if (d.preview) {
      onEdit({ type: "trimClip", clipId: d.clipId, edge: d.mode === "trim-start" ? "start" : "end", atUs: d.edgeUs });
    }
  };

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Controles de formulário (texto, deslizantes) ficam com as próprias teclas.
      if (keyboardDisabled || isFormControl(e.target) || e.altKey) return;
      const key = e.key;
      const frame = frameDurationMicros(fps);
      let handled = true;
      if (key === "Escape" && dragRef.current) finishDrag(false);
      else if ((key === "Delete" || key === "Backspace") && !e.ctrlKey) {
        if (selected.size) onEdit({ type: "deleteClips", clipIds: [...selected] });
      } else if ((key.toLowerCase() === "s" && !e.ctrlKey) || (key.toLowerCase() === "b" && e.ctrlKey)) {
        const targets = splitTargets(project, selected, playheadUs);
        if (targets.length)
          onEdit({
            type: "batch",
            actions: targets.map((c) => ({ type: "splitClip", clipId: c.id, atUs: playheadUs, newClipId: newId() })),
          });
      } else if (key === "Home") onPlayhead(0);
      else if (key === "End") onPlayhead(durationUs);
      else if (key === "ArrowLeft") onPlayhead(Math.max(0, snapToFrame(playheadUs - (e.shiftKey ? US_PER_SECOND : frame), fps)));
      else if (key === "ArrowRight") onPlayhead(snapToFrame(playheadUs + (e.shiftKey ? US_PER_SECOND : frame), fps));
      else if ((key === "+" || key === "=") && !e.ctrlKey) zoomBy(1.25);
      else if (key === "-" && !e.ctrlKey) zoomBy(0.8);
      else if (key === "a" && e.ctrlKey) onSelect(new Set(tracks.flatMap((t) => t.clips.map((c) => c.id))));
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- render ----------
  const shownTracks = drag?.preview?.tracks ?? tracks;
  const ticks = rulerTicks(pxToUs(scrollLeft, pxPerSecond), viewportWidth, pxPerSecond);
  const playheadX = usToPx(playheadUs, pxPerSecond);
  const splitCount = splitTargets(project, selected, playheadUs).length;

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-toolbar">
        <button
          onClick={() =>
            onEdit({
              type: "batch",
              actions: splitTargets(project, selected, playheadUs).map((c) => ({
                type: "splitClip" as const,
                clipId: c.id,
                atUs: playheadUs,
                newClipId: newId(),
              })),
            })
          }
          disabled={splitCount === 0}
          title="Dividir no playhead (S ou Ctrl+B)"
        >
          ✂ Dividir
        </button>
        <button
          onClick={() => onEdit({ type: "deleteClips", clipIds: [...selected] })}
          disabled={selected.size === 0}
          title="Excluir selecionados (Delete)"
        >
          Excluir
        </button>
        <span className="toolbar-timecode">{formatTimecode(playheadUs, fps)}</span>
        <span className="toolbar-spacer" />
        <button onClick={() => zoomBy(0.8)} title="Diminuir zoom (−)" aria-label="Diminuir zoom">
          −
        </button>
        <span className="toolbar-zoom">{Math.round(pxPerSecond)} px/s</span>
        <button onClick={() => zoomBy(1.25)} title="Aumentar zoom (+ ou Ctrl+roda)" aria-label="Aumentar zoom">
          +
        </button>
        <button onClick={zoomFit} title="Ajustar a timeline à largura">
          Ajustar
        </button>
      </div>

      <div className="timeline-body">
        <div className="track-headers">
          <div className="track-header ruler-spacer" style={{ height: RULER_HEIGHT }} />
          {tracks.map((t) => (
            <div key={t.id} className="track-header" style={{ height: TRACK_HEIGHT }}>
              <span className="badge" style={{ background: t.kind === "video" ? "var(--track-video)" : "var(--track-audio)" }} />
              {t.name}
            </div>
          ))}
        </div>

        <div className="timeline-scroller" ref={scrollerRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
          <div className="timeline-content" style={{ width: contentWidth }}>
            <div
              className="ruler"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
            >
              {ticks.map((t) => {
                const x = usToPx(t.timeUs, pxPerSecond);
                return (
                  <div key={t.timeUs}>
                    <div className={`tick ${t.major ? "major" : "minor"}`} style={{ left: x }} />
                    {t.major && (
                      <span className="tick-label" style={{ left: x }}>
                        {formatTimecode(t.timeUs, fps)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="lanes" ref={lanesRef}>
              {shownTracks.map((track, ti) => (
                <div key={track.id} className="track-lane" style={{ height: TRACK_HEIGHT }} onPointerDown={onLanePointerDown}>
                  {track.clips.map((clip) => {
                    const m = mediaById.get(clip.mediaId);
                    const dragging = drag?.active && drag.mode === "move" && drag.clipId === clip.id;
                    return (
                      <div
                        key={clip.id}
                        className={[
                          "clip",
                          track.kind,
                          m?.kind === "image" ? "image" : "",
                          selected.has(clip.id) ? "selected" : "",
                          dragging ? "dragging" : "",
                        ].join(" ")}
                        style={{
                          left: usToPx(clip.timelineStartUs, pxPerSecond),
                          width: Math.max(2, usToPx(clipDurationUs(clip), pxPerSecond)),
                        }}
                        title={`${m?.name ?? "mídia ausente"} · ${(clipDurationUs(clip) / US_PER_SECOND).toFixed(2)} s`}
                        data-clip-id={clip.id}
                        data-clip-name={m?.name}
                        data-start-us={clip.timelineStartUs}
                        data-end-us={clipEndUs(clip)}
                        data-track-index={ti}
                        onPointerDown={(e) => onClipPointerDown(e, clip.id, ti)}
                        onPointerMove={onClipPointerMove}
                        onPointerUp={() => finishDrag(true)}
                        onPointerCancel={() => finishDrag(false)}
                      >
                        <span className="clip-edge start" />
                        <span className="clip-label">{m?.name ?? "?"}</span>
                        <span className="clip-edge end" />
                      </div>
                    );
                  })}
                  {drag?.active && drag.mode === "move" && drag.trackIndex === ti && (
                    <div
                      className={`clip-ghost ${drag.valid ? "valid" : "invalid"}`}
                      style={{ left: usToPx(drag.startUs, pxPerSecond), width: usToPx(drag.durationUs, pxPerSecond) }}
                    />
                  )}
                </div>
              ))}
            </div>

            {drag?.active && drag.snappedAt !== null && (
              <div className="snap-guide" style={{ left: usToPx(drag.snappedAt, pxPerSecond) }} />
            )}
            <div className="playhead" style={{ left: playheadX }} />
          </div>
        </div>
      </div>
    </section>
  );
}
