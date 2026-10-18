import { useLayoutEffect, useRef } from "react";
import { activeClipsAt, clipsToMount, cssFilter, planElement, type ActiveClip } from "../core/preview/composition";
import type { MediaRef, Project } from "../core/project/schema";
import { frameDurationMicros, type Micros, US_PER_SECOND } from "../core/time";
import type { MediaSource } from "../state/useMediaSources";

/** Clipes começando em até 2 s são montados antes para trocar sem engasgo. */
const LOOKAHEAD_US = 2 * US_PER_SECOND;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

interface PreviewPlayerProps {
  project: Project;
  playheadUs: Micros;
  playing: boolean;
  sources: Record<string, MediaSource>;
  onUnsupported: (media: MediaRef) => void;
}

/** O elemento de um clipe toca o próprio som? (faixa não silenciada e mídia com áudio) */
function audible(a: ActiveClip): boolean {
  return !a.track.muted && a.media.hasAudio;
}

export function PreviewPlayer({ project, playheadUs, playing, sources, onUnsupported }: PreviewPlayerProps) {
  const elements = useRef(new Map<string, HTMLMediaElement>());
  const { settings } = project;
  const mounted = clipsToMount(project, playheadUs, LOOKAHEAD_US);
  const activeIds = new Set(activeClipsAt(project, playheadUs).map((a) => a.clip.id));
  const frameUs = frameDurationMicros(settings.fps);
  const trackCount = project.tracks.length;

  // Sincroniza todos os elementos montados com o playhead (a cada quadro enquanto toca).
  useLayoutEffect(() => {
    for (const a of mounted) {
      const el = elements.current.get(a.clip.id);
      if (!el) continue;
      const plan = planElement({
        clip: a.clip,
        t: playheadUs,
        active: activeIds.has(a.clip.id),
        playing,
        actualUs: el.currentTime * US_PER_SECOND,
        frameUs,
      });
      el.playbackRate = a.clip.speed;
      // Ganho acima de 1 ainda não é reproduzido na pré-visualização (limite do <video>).
      el.volume = Math.min(1, a.clip.volume);
      el.muted = !audible(a);
      if (plan.seekToUs !== null && !(plan.play && el.seeking)) el.currentTime = plan.seekToUs / US_PER_SECOND;
      if (plan.play && el.paused) el.play().catch(() => {});
      else if (!plan.play && !el.paused) el.pause();
    }
  });

  const register = (clipId: string) => (el: HTMLMediaElement | null) => {
    if (el) elements.current.set(clipId, el);
    else elements.current.delete(clipId);
  };

  const visualActive = mounted.filter((a) => activeIds.has(a.clip.id) && a.track.kind === "video" && a.media.hasVideo);
  const busy = visualActive.map((a) => sources[a.media.id]).find((s) => s && s.status !== "ready");
  const hasClips = project.tracks.some((t) => t.clips.length > 0);

  return (
    <div
      className="preview-frame"
      style={
        {
          aspectRatio: `${settings.width} / ${settings.height}`,
          background: settings.background,
          "--ar": settings.width / settings.height,
        } as React.CSSProperties
      }
    >
      {mounted.map((a) => {
        const src = sources[a.media.id];
        if (!src?.url) return null;
        const key = `${a.clip.id}|${src.url}`;
        const visible = activeIds.has(a.clip.id) && a.track.kind === "video" && !a.track.hidden;
        const style = {
          zIndex: trackCount - a.trackIndex,
          visibility: visible ? ("visible" as const) : ("hidden" as const),
          filter: cssFilter(a.clip),
        };
        if (a.track.kind === "video" && a.media.kind === "image")
          return <img key={key} className="preview-layer" src={src.url} style={style} alt="" draggable={false} />;
        if (a.track.kind === "video")
          return (
            <video
              key={key}
              ref={register(a.clip.id)}
              className="preview-layer"
              src={src.url}
              style={style}
              preload="auto"
              playsInline
              data-clip-id={a.clip.id}
              onError={(e) => {
                if (e.currentTarget.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED && !src.proxied) onUnsupported(a.media);
              }}
            />
          );
        return (
          <audio
            key={key}
            ref={register(a.clip.id)}
            src={src.url}
            preload="auto"
            data-clip-id={a.clip.id}
            onError={(e) => {
              if (e.currentTarget.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED && !src.proxied) onUnsupported(a.media);
            }}
          />
        );
      })}

      {!hasClips && <div className="preview-message">Adicione mídias à timeline para ver a pré-visualização.</div>}
      {busy?.status === "proxying" && (
        <div className="preview-message">Gerando proxy de pré-visualização para um formato não suportado…</div>
      )}
      {busy?.status === "error" && <div className="preview-message error">{busy.error}</div>}
    </div>
  );
}
