import { formatTimecode } from "./core/time";
import { useProjectDocument } from "./state/useProjectDocument";
import { StatusBar } from "./ui/StatusBar";
import { Timeline } from "./ui/Timeline";
import { TopBar } from "./ui/TopBar";
import "./ui/theme.css";

export default function App() {
  const { doc, newProject, openProject, saveProject, saveAs, rename } = useProjectDocument();
  const { settings, tracks } = doc.project;

  return (
    <div className="app">
      <TopBar
        doc={doc}
        onNew={newProject}
        onOpen={openProject}
        onSave={saveProject}
        onSaveAs={saveAs}
        onRename={rename}
      />

      <main className="workspace">
        <section className="panel" aria-label="Biblioteca de mídias">
          <div className="panel-header">Mídias</div>
          <div className="panel-body">
            <div className="empty-state">
              <strong>Biblioteca vazia</strong>
              A importação de vídeos, imagens e áudios ainda não foi implementada.
            </div>
          </div>
        </section>

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
                <span className="preview-timecode">{formatTimecode(0, settings.fps)}</span>
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

      <Timeline
        tracks={tracks.map((t) => ({ id: t.id, label: t.name, kind: t.kind }))}
        fps={settings.fps}
        pxPerSecond={60}
        scrollUs={0}
        playheadUs={0}
      />

      <StatusBar />
    </div>
  );
}
