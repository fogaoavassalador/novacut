import { useEffect, useRef, useState } from "react";
import { formatTimecode, type Micros } from "../core/time";
import { rulerTicks } from "../core/timeline/ruler";

interface TrackInfo {
  id: string;
  label: string;
  kind: "video" | "audio";
}

interface TimelineProps {
  tracks: TrackInfo[];
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

export function Timeline({ tracks, fps, pxPerSecond, scrollUs, playheadUs }: TimelineProps) {
  const [rulerRef, width] = useWidth<HTMLDivElement>();
  const ticks = rulerTicks(scrollUs, width, pxPerSecond);
  const playheadX = ((playheadUs - scrollUs) / 1_000_000) * pxPerSecond;

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
        <div className="playhead" style={{ left: playheadX }} />
      </div>
      {tracks.map((track) => (
        <TrackRow key={track.id} track={track} playheadX={playheadX} />
      ))}
    </section>
  );
}

function TrackRow({ track, playheadX }: { track: TrackInfo; playheadX: number }) {
  const color = track.kind === "video" ? "var(--track-video)" : "var(--track-audio)";
  return (
    <>
      <div className="track-header">
        <span className="badge" style={{ background: color }} />
        {track.label}
      </div>
      <div className="track-lane">
        <div className="playhead" style={{ left: playheadX }} />
      </div>
    </>
  );
}
