import { useEffect, useState } from "react";
import { newId } from "./core/project/project";
import { formatTimecode, type Micros } from "./core/time";
import { pruneSelection } from "./core/timeline/selection";
import { canRedo, canUndo } from "./state/document";
import { useMediaImport } from "./state/useMediaImport";
import { useProjectDocument } from "./state/useProjectDocument";
import { MediaLibrary } from "./ui/MediaLibrary";
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

  // Clipes que deixaram de existir (desfazer, excluir, abrir outro projeto) saem da seleção.
  useEffect(() => setSelected((s) => pruneSelection(doc.project, s)), [doc.project]);

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
          <div className="panel-body">
            <div className="preview-stage">
              <div
                className="preview-frame"
                style={{ aspectRatio: `${settings.width} / ${settings.height}`, background: settings.background }}
              >
                <span className="preview-timecode">{formatTimecode(playheadUs, settings.fps)}</span>
              </div>
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
