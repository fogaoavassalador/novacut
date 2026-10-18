import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Autoriza o WebView a ler os arquivos (escopo do protocolo `asset`). */
export function allowMediaFiles(paths: string[]): Promise<void> {
  return invoke("allow_media_files", { paths });
}

/** URL para <video>/<audio>/<img> a partir de um caminho local já autorizado. */
export function mediaUrl(path: string): string {
  return convertFileSrc(path);
}

/** Gera (ou reaproveita) um proxy H.264 para pré-visualização e devolve sua URL. */
export async function proxyUrl(path: string): Promise<string> {
  const proxy = await invoke<string>("ensure_proxy", { path });
  return convertFileSrc(proxy);
}
