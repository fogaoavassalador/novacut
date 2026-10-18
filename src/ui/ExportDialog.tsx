import { videoDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { buildExportPlan, type H264Encoder } from "../core/export/ffmpegArgs";
import {
  ENCODER_LABEL,
  formatDuration,
  QUALITY_LABEL,
  remainingMs,
  resolutionOptions,
  videoBitrateFor,
  type Quality,
} from "../core/export/presets";
import { newId, projectDurationUs } from "../core/project/project";
import type { Project } from "../core/project/schema";
import { formatTimecode } from "../core/time";
import {
  cancelExport,
  onExportDone,
  onExportProgress,
  pickExportPath,
  revealInExplorer,
  startExport,
  workingEncoders,
} from "../platform/export";

interface ExportDialogProps {
  project: Project;
  /** Caminho do .ncproj, usado para sugerir a pasta de saída. */
  projectPath: string | null;
  onClose: () => void;
}

type Phase =
  | { kind: "setup" }
  | { kind: "running"; jobId: string; startedAt: number; fraction: number; speed: number | null }
  | { kind: "done"; outputPath: string }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "video";
const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

export function ExportDialog({ project, projectPath, onClose }: ExportDialogProps) {
  const resolutions = resolutionOptions(project.settings);
  const [resIndex, setResIndex] = useState(0);
  const [quality, setQuality] = useState<Quality>("alta");
  const [encoders, setEncoders] = useState<string[] | null>(null);
  const [encoder, setEncoder] = useState<string>("");
  const [outputPath, setOutputPath] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const durationUs = projectDurationUs(project);

  // Encoders que funcionam nesta máquina (o primeiro é o preferido).
  useEffect(() => {
    workingEncoders()
      .then((list) => {
        setEncoders(list);
        setEncoder((e) => e || list[0] || "");
      })
      .catch(() => setEncoders([]));
  }, []);

  // Sugestão de arquivo: pasta do projeto (ou Vídeos) + nome do projeto.
  useEffect(() => {
    const name = `${sanitize(project.name)}.mp4`;
    if (projectPath) setOutputPath(`${dirOf(projectPath)}\\${name}`);
    else videoDir().then((d) => setOutputPath(`${d.replace(/[\\/]$/, "")}\\${name}`)).catch(() => setOutputPath(name));
  }, [project.name, projectPath]);

  // Eventos do backend (filtrados pelo job atual).
  useEffect(() => {
    const unProgress = onExportProgress((e) => {
      const p = phaseRef.current;
      if (p.kind !== "running" || p.jobId !== e.jobId) return;
      setPhase({ ...p, fraction: Math.min(1, e.outTimeUs / durationUs), speed: e.speed });
    });
    const unDone = onExportDone((e) => {
      const p = phaseRef.current;
      if (p.kind !== "running" || p.jobId !== e.jobId) return;
      if (e.ok) setPhase({ kind: "done", outputPath: e.outputPath });
      else if (e.cancelled) setPhase({ kind: "cancelled" });
      else setPhase({ kind: "failed", error: e.error ?? "erro desconhecido" });
    });
    return () => {
      unProgress.then((f) => f());
      unDone.then((f) => f());
    };
  }, [durationUs]);

  const res = resolutions[resIndex];
  const bitrate = videoBitrateFor(quality, res.width, res.height);
  const validPath = /\.mp4$/i.test(outputPath.trim()) && /^[a-zA-Z]:[\\/]/.test(outputPath.trim());

  const start = async () => {
    const path = outputPath.trim();
    try {
      const plan = buildExportPlan(project, {
        outputPath: path,
        encoder: encoder as H264Encoder,
        videoBitrate: bitrate,
        audioBitrate: 192_000,
        width: res.width,
        height: res.height,
      });
      const jobId = newId();
      setPhase({ kind: "running", jobId, startedAt: performance.now(), fraction: 0, speed: null });
      await startExport(jobId, plan.args, path);
    } catch (e) {
      setPhase({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const running = phase.kind === "running";
  const elapsed = running ? performance.now() - phase.startedAt : 0;
  const eta = running ? remainingMs(elapsed, phase.fraction) : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Exportar vídeo">
      <div className="modal export-dialog">
        <h2>Exportar vídeo</h2>

        {phase.kind === "setup" && (
          <>
            <label className="form-row">
              <span>Arquivo</span>
              <span className="path-input">
                <input
                  className="export-path"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  spellCheck={false}
                />
                <button onClick={async () => setOutputPath((await pickExportPath(outputPath)) ?? outputPath)}>
                  Procurar…
                </button>
              </span>
            </label>
            <label className="form-row">
              <span>Resolução</span>
              <select className="export-resolution" value={resIndex} onChange={(e) => setResIndex(Number(e.target.value))}>
                {resolutions.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span>Codificador</span>
              <select
                className="export-encoder"
                value={encoder}
                onChange={(e) => setEncoder(e.target.value)}
                disabled={!encoders?.length}
              >
                {encoders === null && <option>Testando codificadores…</option>}
                {encoders?.length === 0 && <option>Nenhum codificador H.264 funcionando</option>}
                {encoders?.map((e) => (
                  <option key={e} value={e}>
                    {ENCODER_LABEL[e] ?? e}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span>Qualidade</span>
              <select className="export-quality" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                {(Object.keys(QUALITY_LABEL) as Quality[]).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABEL[q]} ({(videoBitrateFor(q, res.width, res.height) / 1e6).toFixed(1)} Mb/s)
                  </option>
                ))}
              </select>
            </label>
            <p className="export-summary">
              MP4 · H.264 + AAC · {project.settings.fps} fps · duração {formatTimecode(durationUs, project.settings.fps)}
            </p>
            {!validPath && outputPath && <p className="export-warning">Informe um caminho completo terminado em .mp4.</p>}
            <div className="modal-actions">
              <button onClick={onClose}>Cancelar</button>
              <button
                className="primary export-start"
                onClick={start}
                disabled={!validPath || !encoder || durationUs === 0}
              >
                Exportar
              </button>
            </div>
          </>
        )}

        {running && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={Math.round(phase.fraction * 100)}>
              <div className="progress-bar" style={{ width: `${phase.fraction * 100}%` }} />
            </div>
            <p className="export-status">
              <span className="export-percent">{Math.round(phase.fraction * 100)}%</span>
              {phase.speed ? ` · ${phase.speed.toFixed(1)}× tempo real` : ""}
              {eta !== null ? ` · faltam ~${formatDuration(eta)}` : ""}
            </p>
            <div className="modal-actions">
              <button className="export-cancel" onClick={() => cancelExport(phase.jobId)}>
                Cancelar exportação
              </button>
            </div>
          </>
        )}

        {phase.kind === "done" && (
          <>
            <p className="export-result ok">Exportação concluída.</p>
            <p className="export-file" title={phase.outputPath}>
              {phase.outputPath}
            </p>
            <div className="modal-actions">
              <button onClick={() => revealInExplorer(phase.outputPath)}>Mostrar no Explorer</button>
              <button className="primary" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}

        {phase.kind === "cancelled" && (
          <>
            <p className="export-result">Exportação cancelada. Nenhum arquivo foi gravado.</p>
            <div className="modal-actions">
              <button onClick={() => setPhase({ kind: "setup" })}>Voltar</button>
              <button className="primary" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}

        {phase.kind === "failed" && (
          <>
            <p className="export-result error">A exportação falhou.</p>
            <pre className="export-error">{phase.error}</pre>
            <div className="modal-actions">
              <button onClick={() => setPhase({ kind: "setup" })}>Voltar</button>
              <button className="primary" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
