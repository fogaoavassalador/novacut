import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaRef } from "../core/project/schema";
import { allowMediaFiles, mediaUrl, proxyUrl } from "../platform/preview";

export interface MediaSource {
  /** URL carregável pelo WebView (original ou proxy); `null` enquanto não há. */
  url: string | null;
  status: "authorizing" | "ready" | "proxying" | "error";
  proxied: boolean;
  error?: string;
}

/**
 * Fontes de pré-visualização por mídia: autoriza os arquivos no protocolo
 * `asset` e, quando o WebView não consegue tocar um formato, gera um proxy.
 */
export function useMediaSources(media: readonly MediaRef[]) {
  const [sources, setSources] = useState<Record<string, MediaSource>>({});
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const update = (id: string, s: MediaSource) => setSources((prev) => ({ ...prev, [id]: s }));

  useEffect(() => {
    const pending = media.filter((m) => !sourcesRef.current[m.id]);
    if (!pending.length) return;
    for (const m of pending) update(m.id, { url: null, status: "authorizing", proxied: false });
    allowMediaFiles(pending.map((m) => m.path))
      .then(() => {
        for (const m of pending) update(m.id, { url: mediaUrl(m.path), status: "ready", proxied: false });
      })
      .catch((e: unknown) => {
        for (const m of pending) update(m.id, { url: null, status: "error", proxied: false, error: String(e) });
      });
  }, [media]);

  /** Chamado quando o WebView recusa o formato original. */
  const requestProxy = useCallback((m: MediaRef) => {
    const current = sourcesRef.current[m.id];
    if (current?.proxied || current?.status === "proxying") return;
    update(m.id, { url: null, status: "proxying", proxied: false });
    proxyUrl(m.path)
      .then((url) => update(m.id, { url, status: "ready", proxied: true }))
      .catch((e: unknown) => update(m.id, { url: null, status: "error", proxied: false, error: String(e) }));
  }, []);

  return { sources, requestProxy };
}
