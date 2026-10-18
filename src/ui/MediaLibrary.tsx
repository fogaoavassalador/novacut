import { useEffect, useState } from "react";
import { isMediaInUse, thumbnailTimeUs } from "../core/media/media";
import type { MediaRef, Project } from "../core/project/schema";
import { formatTimecode } from "../core/time";
import { getThumbnailUrl } from "../platform/media";
import type { ImportState } from "../state/useMediaImport";

interface MediaLibraryProps {
  project: Project;
  importState: ImportState;
  onImport: () => void;
  onRemove: (mediaId: string) => void;
  /** Duplo clique: adiciona a mídia à timeline. */
  onActivate: (mediaId: string) => void;
  onDismissNotice: () => void;
}

const KIND_LABEL = { video: "Vídeo", audio: "Áudio", image: "Imagem" } as const;

export function MediaLibrary({ project, importState, onImport, onRemove, onActivate, onDismissNotice }: MediaLibraryProps) {
  const { media } = project;
  const { pending, failures, skipped, dragOver } = importState;

  return (
    <section className={`panel media-panel${dragOver ? " drag-over" : ""}`} aria-label="Biblioteca de mídias">
      <div className="panel-header">
        Mídias
        <span className="panel-header-meta">{media.length || ""}</span>
        <button className="header-button" onClick={onImport} title="Importar vídeos, áudios e imagens">
          Importar…
        </button>
      </div>

      {(pending > 0 || failures.length > 0 || skipped > 0) && (
        <div className={`notice${failures.length ? " error" : ""}`} role="status">
          {pending > 0 && <div>Analisando {pending} arquivo(s)…</div>}
          {skipped > 0 && <div>{skipped} arquivo(s) já estavam no projeto e foram ignorados.</div>}
          {failures.length > 0 && (
            <>
              <div>Não foi possível importar {failures.length} arquivo(s):</div>
              <ul>
                {failures.map((f) => (
                  <li key={f.path} title={f.path}>
                    <strong>{f.name}</strong>: {f.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {pending === 0 && (
            <button className="notice-close" onClick={onDismissNotice} aria-label="Fechar aviso">
              ×
            </button>
          )}
        </div>
      )}

      <div className="panel-body">
        {media.length === 0 ? (
          <div className="empty-state">
            <strong>Biblioteca vazia</strong>
            Clique em Importar… ou arraste vídeos, áudios e imagens para a janela. Depois, dê um duplo clique numa mídia para levá-la à timeline.
          </div>
        ) : (
          <ul className="media-grid">
            {media.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                inUse={isMediaInUse(project, m.id)}
                onRemove={onRemove}
                onActivate={onActivate}
              />
            ))}
          </ul>
        )}
      </div>

      {dragOver && <div className="drop-overlay">Solte para importar</div>}
    </section>
  );
}

interface MediaCardProps {
  media: MediaRef;
  inUse: boolean;
  onRemove: (id: string) => void;
  onActivate: (id: string) => void;
}

function MediaCard({ media, inUse, onRemove, onActivate }: MediaCardProps) {
  const details = [
    KIND_LABEL[media.kind],
    media.width && media.height ? `${media.width}×${media.height}` : null,
    media.fps ? `${Math.round(media.fps * 100) / 100} fps` : null,
  ].filter(Boolean);

  return (
    <li
      className="media-card"
      title={`${media.path}\nDuplo clique para adicionar à timeline`}
      onDoubleClick={() => onActivate(media.id)}
    >
      <Thumbnail media={media} />
      {media.durationUs !== null && (
        <span className="media-duration">{formatTimecode(media.durationUs, media.fps ?? 30)}</span>
      )}
      <div className="media-name">{media.name}</div>
      <div className="media-meta">{details.join(" · ")}</div>
      <button
        className="media-remove"
        disabled={inUse}
        onClick={() => onRemove(media.id)}
        onDoubleClick={(e) => e.stopPropagation()}
        title={inUse ? "Em uso na timeline" : "Remover da biblioteca"}
        aria-label={`Remover ${media.name}`}
      >
        ×
      </button>
    </li>
  );
}

function Thumbnail({ media }: { media: MediaRef }) {
  const at = thumbnailTimeUs(media);
  const [state, setState] = useState<{ url?: string; error?: string }>({});

  useEffect(() => {
    if (at === null) return;
    let alive = true;
    setState({});
    getThumbnailUrl(media.path, at)
      .then((url) => alive && setState({ url }))
      .catch((e: unknown) => alive && setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [media.path, at]);

  if (at === null) return <div className="media-thumb audio" aria-hidden>♪</div>;
  if (state.error)
    return (
      <div className="media-thumb missing" title={state.error}>
        sem prévia
      </div>
    );
  return (
    <div className="media-thumb">{state.url ? <img src={state.url} alt="" draggable={false} /> : null}</div>
  );
}
