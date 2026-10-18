import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useState } from "react";
import { fileName, findMediaByPath, mediaRefFromProbe } from "../core/media/media";
import { newId } from "../core/project/project";
import type { MediaRef, Project } from "../core/project/schema";
import { mapLimit } from "../core/util/mapLimit";
import { pickMediaFiles, probeMedia } from "../platform/media";

/** ffprobe simultâneos durante uma importação. */
const PROBE_CONCURRENCY = 4;

export interface ImportFailure {
  name: string;
  path: string;
  reason: string;
}

export interface ImportState {
  /** Arquivos sendo analisados agora (0 = ocioso). */
  pending: number;
  failures: ImportFailure[];
  /** Arquivos ignorados por já estarem no projeto, na última importação. */
  skipped: number;
  dragOver: boolean;
}

export function useMediaImport(getProject: () => Project, addMedia: (media: MediaRef[]) => void) {
  const [state, setState] = useState<ImportState>({ pending: 0, failures: [], skipped: 0, dragOver: false });

  const importPaths = useCallback(
    async (paths: string[]) => {
      const project = getProject();
      const unique = [...new Set(paths)];
      const fresh = unique.filter((p) => !findMediaByPath(project, p));
      setState((s) => ({ ...s, pending: s.pending + fresh.length, failures: [], skipped: unique.length - fresh.length }));
      if (!fresh.length) return;

      const results = await mapLimit(fresh, PROBE_CONCURRENCY, async (path) =>
        mediaRefFromProbe(await probeMedia(path), path, newId()),
      );
      const ok: MediaRef[] = [];
      const failures: ImportFailure[] = [];
      results.forEach((r, i) => {
        if (r.ok) ok.push(r.value);
        else failures.push({ path: fresh[i], name: fileName(fresh[i]), reason: String(r.error) });
      });
      if (ok.length) addMedia(ok);
      setState((s) => ({ ...s, pending: s.pending - fresh.length, failures }));
    },
    [getProject, addMedia],
  );

  const importFromDialog = useCallback(async () => {
    const paths = await pickMediaFiles();
    if (paths.length) await importPaths(paths);
  }, [importPaths]);

  const dismissFailures = useCallback(() => setState((s) => ({ ...s, failures: [], skipped: 0 })), []);

  // Arrastar e soltar arquivos do Explorer em qualquer ponto da janela.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setState((s) => (s.dragOver ? s : { ...s, dragOver: true }));
      else if (p.type === "leave") setState((s) => ({ ...s, dragOver: false }));
      else if (p.type === "drop") {
        setState((s) => ({ ...s, dragOver: false }));
        void importPaths(p.paths);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [importPaths]);

  return { importState: state, importFromDialog, importPaths, dismissFailures };
}
