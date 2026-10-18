import { useEffect, useState } from "react";
import { newId, projectDurationUs } from "./core/project/project";
import { formatTimecode, type Micros } from "./core/time";
import { pruneSelection } from "./core/timeline/selection";
import { canRedo, canUndo } from "./state/document";
import { useMediaImport } from "./state/useMediaImport";
import { useMediaSources } from "./state/useMediaSources";
import { usePlayback } from "./state/usePlayback";
import { useProjectDocument } from "./state/useProjectDocument";
import { MediaLibrary } from "./ui/MediaLibrary";
import { PreviewPlayer } from "./ui/PreviewPlayer";
import { StatusBar } from "./ui/StatusBar";
import { Timeline } from "./ui/Timeline";
import { TopBar } from "./ui/TopBar";
import "./ui/theme.css";

/** Tempo que um aviso de edição recusada fica visível. */
const ERROR_TOAST_MS = 4000;

export default function App() {
  const {
    doc,
    newProject,
    openProject,
    saveProject,
    saveAs,
    rename,
    addMedia,
    removeMedia,
    getProject,
    edit,
    undo,
    redo,
    clearError,
  } = useProjectDocument();
  const { importState, importFromDialog, dismissFailures } = useMediaImport(getProject, addMedia);
  const { settings } = doc.project;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [playheadUs, setPlayheadUs] = useState<Micros>(0);

  const durationUs = projectDurationUs(doc.project);
  const { playing, toggle, pause } = usePlayback(durationUs, playheadUs, setPlayheadUs);
  const { sources, requestProxy } = useMediaSources(doc.project.media);

  // Clipes que deixaram de existir (desfazer, excluir, abrir outro projeto) saem da seleção.
  useEffect(() => setSelected((s) => pruneSelection(doc.project, s)), [doc.project]);

  // Outro projeto aberto: para a reprodução e volta ao início.
  useEffect(() => {
    pause();
    setPlayheadUs(0);
  }, [doc.project.id, pause]);

  // Espaço: reproduzir / pausar (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => {
    if (!doc.lastError) return;
    const t = setTimeout(clearError, ERROR_TOAST_MS);
    return () => clearTimeout(t);
  }, [doc.lastError, clearError]);

  return (
    <div className="app">
      <TopBar
        doc={doc}
        onNew={newProject}
        onOpen={openProject}
        onSave={saveProject}
        onSaveAs={saveAs}
        onRename={rename}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo(doc)}
        canRedo={canRedo(doc)}
      />

      <main className="workspace">
        <MediaLibrary
          project={doc.project}
          importState={importState}
          onImport={importFromDialog}
          onRemove={removeMedia}
          onActivate={(mediaId) => edit({ type: "addClip", clipId: newId(), mediaId })}
          onDismissNotice={dismissFailures}
        />

        <section className="panel" aria-label="Pré-visualização">
          <div className="panel-header">
            Pré-visualização
            <span className="panel-header-meta">
              {settings.width}×{settings.height} · {settings.fps} fps
            </span>
          </div>
          <div className="panel-body preview-body">
            <div className="preview-stage">
              <PreviewPlayer
                project={doc.project}
                playheadUs={playheadUs}
                playing={playing}
                sources={sources}
                onUnsupported={requestProxy}
              />
            </div>
            <div className="preview-controls">
              <button
                className="play-button"
                onClick={(e) => {
                  toggle();
                  e.currentTarget.blur(); // a barra de espaço não deve "clicar" o botão de novo
                }}
                disabled={durationUs === 0}
                title="Reproduzir / pausar (Espaço)"
                aria-label={playing ? "Pausar" : "Reproduzir"}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <span className="preview-time">
                <span className="preview-time-current">{formatTimecode(playheadUs, settings.fps)}</span>
                {" / "}
                {formatTimecode(durationUs, settings.fps)}
              </span>
            </div>
          </div>
        </section>

        <section className="panel" aria-label="Propriedades">
          <div className="panel-header">Propriedades</div>
          <div className="panel-body">
            <div className="empty-state">
              <strong>Nenhum clipe selecionado</strong>
              Volume, velocidade, brilho e contraste aparecerão aqui.
            </div>
          </div>
        </section>
      </main>

      <div className="timeline-wrap">
        <Timeline
          project={doc.project}
          selected={selected}
          onSelect={setSelected}
          playheadUs={playheadUs}
          onPlayhead={setPlayheadUs}
          onEdit={edit}
          following={playing}
        />
        {doc.lastError && (
          <div className="edit-error" role="alert" onClick={clearError}>
            {doc.lastError}
          </div>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
