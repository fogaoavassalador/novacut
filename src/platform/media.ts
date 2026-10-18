import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { IMPORT_EXTENSIONS, type MediaProbe } from "../core/media/media";
import type { Micros } from "../core/time";

export function probeMedia(path: string): Promise<MediaProbe> {
  return invoke<MediaProbe>("probe_media", { path });
}

export async function pickMediaFiles(): Promise<string[]> {
  const all = [...IMPORT_EXTENSIONS.video, ...IMPORT_EXTENSIONS.audio, ...IMPORT_EXTENSIONS.image];
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Mídias suportadas", extensions: all },
      { name: "Vídeos", extensions: [...IMPORT_EXTENSIONS.video] },
      { name: "Áudios", extensions: [...IMPORT_EXTENSIONS.audio] },
      { name: "Imagens", extensions: [...IMPORT_EXTENSIONS.image] },
    ],
  });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** Cache por sessão: caminho + instante → URL de Blob da miniatura (ou promessa em curso). */
const thumbCache = new Map<string, Promise<string>>();

export function getThumbnailUrl(path: string, atUs: Micros): Promise<string> {
  const key = `${atUs}|${path}`;
  let url = thumbCache.get(key);
  if (!url) {
    url = invoke<ArrayBuffer>("media_thumbnail", { path, atUs }).then((buf) =>
      URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })),
    );
    // Falhas não ficam no cache: o arquivo pode voltar a existir.
    url.catch(() => thumbCache.delete(key));
    thumbCache.set(key, url);
  }
  return url;
}
