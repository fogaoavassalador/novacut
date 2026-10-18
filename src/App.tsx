import { formatTimecode } from "./core/time";
import { StatusBar } from "./ui/StatusBar";
import { Timeline } from "./ui/Timeline";
import "./ui/theme.css";

const FPS = 30;

// Faixas iniciais fixas até o modelo de projeto existir (etapa 2).
const DEFAULT_TRACKS = [
  { id: "v2", label: "V2", kind: "video" as const },
  { id: "v1", label: "V1", kind: "video" as const },
  { id: "a1", label: "A1", kind: "audio" as const },
];

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Nova<span>Cut</span>
        </div>
        <div className="project-name">Projeto sem título</div>
      </header>

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
          <div className="panel-header">Pré-visualização</div>
          <div className="panel-body">
            <div className="preview-stage">
              <div className="preview-frame">
                <span className="preview-timecode">{formatTimecode(0, FPS)}</span>
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

      <Timeline tracks={DEFAULT_TRACKS} fps={FPS} pxPerSecond={60} scrollUs={0} playheadUs={0} />

      <StatusBar />
    </div>
  );
}
