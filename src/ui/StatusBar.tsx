import { useEffect, useState } from "react";
import { getFfmpegStatus, type FfmpegStatus } from "../platform/ffmpeg";

type State =
  | { kind: "loading" }
  | { kind: "ready"; status: FfmpegStatus }
  | { kind: "failed"; message: string };

export function StatusBar() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    getFfmpegStatus()
      .then((status) => alive && setState({ kind: "ready", status }))
      .catch((e: unknown) => alive && setState({ kind: "failed", message: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="statusbar">
      <FfmpegIndicator state={state} />
    </footer>
  );
}

function FfmpegIndicator({ state }: { state: State }) {
  if (state.kind === "loading") {
    return (
      <span>
        <span className="dot warn" />
        Verificando FFmpeg…
      </span>
    );
  }
  if (state.kind === "failed") {
    return (
      <span title={state.message}>
        <span className="dot err" />
        Não foi possível consultar o FFmpeg (o app está rodando fora do Tauri?)
      </span>
    );
  }
  const s = state.status;
  if (!s.found) {
    return (
      <span title={s.error ?? ""}>
        <span className="dot err" />
        FFmpeg não encontrado
      </span>
    );
  }
  const encoders = s.h264Encoders.length ? s.h264Encoders.join(", ") : "nenhum";
  return (
    <span title={`${s.ffmpegPath ?? ""}${s.error ? `\n${s.error}` : ""}`}>
      <span className={`dot ${s.error ? "warn" : "ok"}`} />
      FFmpeg {s.version} · {s.license} · encoders H.264 compilados: {encoders}
    </span>
  );
}
