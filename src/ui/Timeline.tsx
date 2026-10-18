import { useEffect, useRef, useState } from "react";
import { clipDurationUs } from "../core/project/project";
import type { MediaRef, Track } from "../core/project/schema";
import { formatTimecode, type Micros, US_PER_SECOND } from "../core/time";
import { rulerTicks } from "../core/timeline/ruler";

interface TimelineProps {
  tracks: Track[];
  media: MediaRef[];
  fps: number;
  pxPerSecond: number;
  scrollUs: Micros;
  playheadUs: Micros;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Timeline({ tracks, media, fps, pxPerSecond, scrollUs, playheadUs }: TimelineProps) {
  const [rulerRef, width] = useWidth<HTMLDivElement>();
  const ticks = rulerTicks(scrollUs, width, pxPerSecond);
  const toX = (us: Micros) => ((us - scrollUs) / US_PER_SECOND) * pxPerSecond;
  const mediaById = new Map(media.map((m) => [m.id, m]));

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="track-header" />
      <div className="ruler" ref={rulerRef}>
        {ticks.map((t) => (
          <div key={t.timeUs}>
            <div className={`tick ${t.major ? "major" : "minor"}`} style={{ left: t.x }} />
            {t.major && (
              <span className="tick-label" style={{ left: t.x }}>
                {formatTimecode(t.timeUs, fps)}
              </span>
            )}
          </div>
        ))}
        <div className="playhead" style={{ left: toX(playheadUs) }} />
      </div>
      {tracks.map((track) => (
        <TrackRow key={track.id} track={track} mediaById={mediaById} toX={toX} pxPerSecond={pxPerSecond} playheadX={toX(playheadUs)} />
      ))}
    </section>
  );
}

interface TrackRowProps {
  track: Track;
  mediaById: Map<string, MediaRef>;
  toX: (us: Micros) => number;
  pxPerSecond: number;
  playheadX: number;
}

function TrackRow({ track, mediaById, toX, pxPerSecond, playheadX }: TrackRowProps) {
  const color = track.kind === "video" ? "var(--track-video)" : "var(--track-audio)";
  return (
    <>
      <div className="track-header">
        <span className="badge" style={{ background: color }} />
        {track.name}
      </div>
      <div className="track-lane">
        {track.clips.map((clip) => {
          const m = mediaById.get(clip.mediaId);
          const widthPx = (clipDurationUs(clip) / US_PER_SECOND) * pxPerSecond;
          return (
            <div
              key={clip.id}
              className={`clip ${track.kind}${m?.kind === "image" ? " image" : ""}`}
              style={{ left: toX(clip.timelineStartUs), width: Math.max(2, widthPx) }}
              title={`${m?.name ?? "mídia ausente"}\n${(clipDurationUs(clip) / US_PER_SECOND).toFixed(2)} s`}
            >
              <span className="clip-label">{m?.name ?? "?"}</span>
            </div>
          );
        })}
        <div className="playhead" style={{ left: playheadX }} />
      </div>
    </>
  );
}
