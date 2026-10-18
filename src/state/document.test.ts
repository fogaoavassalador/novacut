import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../core/project/project";
import type { MediaRef } from "../core/project/schema";
import {
  canRedo,
  canUndo,
  DEFAULT_PROJECT_NAME,
  HISTORY_LIMIT,
  documentReducer,
  fileStem,
  initialDocument,
  prepareForSave,
  windowTitle,
  withProjectExtension,
} from "./document";

const NOW = new Date("2026-10-18T12:00:00.000Z");

describe("documentReducer", () => {
  it("documento inicial não tem arquivo nem alterações", () => {
    const d = initialDocument();
    expect(d.filePath).toBeNull();
    expect(d.dirty).toBe(false);
    expect(d.project.name).toBe(DEFAULT_PROJECT_NAME);
  });

  it("renomear marca como alterado; mesmo nome ou vazio não", () => {
    const d = initialDocument();
    const r = documentReducer(d, { type: "rename", name: "  Férias  " });
    expect(r.project.name).toBe("Férias");
    expect(r.dirty).toBe(true);
    expect(documentReducer(r, { type: "rename", name: "Férias" })).toBe(r);
    expect(documentReducer(r, { type: "rename", name: "   " })).toBe(r);
  });

  it("salvar limpa o estado alterado e registra o caminho", () => {
    const d = documentReducer(initialDocument(), { type: "rename", name: "X" });
    const saved = documentReducer(d, { type: "saved", project: d.project, filePath: "C:\\p\\x.ncproj" });
    expect(saved).toMatchObject({ filePath: "C:\\p\\x.ncproj", dirty: false });
  });

  it("carregar e novo substituem o documento", () => {
    const p = createEmptyProject("Aberto", NOW);
    const loaded = documentReducer(initialDocument(), { type: "loaded", project: p, filePath: "a.ncproj" });
    expect(loaded).toMatchObject({ project: p, filePath: "a.ncproj", dirty: false, past: [], future: [] });
    const fresh = documentReducer(loaded, { type: "new", project: createEmptyProject("N", NOW) });
    expect(fresh.filePath).toBeNull();
  });
});

describe("mídias", () => {
  const media = (id: string, path: string): MediaRef => ({
    id,
    kind: "video",
    path,
    name: path,
    durationUs: 1_000_000,
    width: 10,
    height: 10,
    fps: 30,
    hasVideo: true,
    hasAudio: false,
  });

  it("adiciona mídias e marca alteração", () => {
    const d = documentReducer(initialDocument(), {
      type: "addMedia",
      media: [media("a", "C:\\v\\a.mp4"), media("b", "C:\\v\\b.mp4")],
    });
    expect(d.project.media.map((m) => m.id)).toEqual(["a", "b"]);
    expect(d.dirty).toBe(true);
  });

  it("ignora arquivos já importados, inclusive repetidos no mesmo lote", () => {
    const d1 = documentReducer(initialDocument(), { type: "addMedia", media: [media("a", "C:\\v\\a.mp4")] });
    const d2 = documentReducer(d1, {
      type: "addMedia",
      media: [media("a2", "c:/V/A.mp4"), media("b", "C:\\v\\b.mp4"), media("b2", "C:\\v\\b.mp4")],
    });
    expect(d2.project.media.map((m) => m.id)).toEqual(["a", "b"]);
    expect(documentReducer(d2, { type: "addMedia", media: [media("x", "C:\\v\\a.mp4")] })).toBe(d2);
  });

  it("remove mídia sem uso; mantém mídia usada por clipe", () => {
    let d = documentReducer(initialDocument(), {
      type: "addMedia",
      media: [media("a", "a.mp4"), media("b", "b.mp4")],
    });
    d = {
      ...d,
      project: {
        ...d.project,
        tracks: d.project.tracks.map((t, i) =>
          i === 1
            ? {
                ...t,
                clips: [
                  {
                    id: "c",
                    mediaId: "b",
                    timelineStartUs: 0,
                    sourceInUs: 0,
                    sourceOutUs: 1_000_000,
                    speed: 1,
                    volume: 1,
                    brightness: 1,
                    contrast: 1,
                  },
                ],
              }
            : t,
        ),
      },
    };
    const removed = documentReducer(d, { type: "removeMedia", mediaId: "a" });
    expect(removed.project.media.map((m) => m.id)).toEqual(["b"]);
    const refused = documentReducer(removed, { type: "removeMedia", mediaId: "b" });
    expect(refused.project).toBe(removed.project);
    expect(refused.lastError).toBe("a mídia está em uso na timeline");
    expect(documentReducer(removed, { type: "removeMedia", mediaId: "nao-existe" })).toBe(removed);
  });
});

describe("histórico (desfazer/refazer)", () => {
  const withVideo = () =>
    documentReducer(initialDocument(), {
      type: "addMedia",
      media: [
        {
          id: "v",
          kind: "video",
          path: "C:\\v.mp4",
          name: "v.mp4",
          durationUs: 10_000_000,
          width: 1920,
          height: 1080,
          fps: 30,
          hasVideo: true,
          hasAudio: true,
        },
      ],
    });

  it("desfaz e refaz uma sequência de edições de timeline", () => {
    let d = withVideo();
    d = documentReducer(d, { type: "addClip", clipId: "c", mediaId: "v" });
    d = documentReducer(d, { type: "splitClip", clipId: "c", atUs: 4_000_000, newClipId: "d" });
    d = documentReducer(d, { type: "moveClip", clipId: "d", startUs: 12_000_000 });
    const clipIds = (x: typeof d) => x.project.tracks.flatMap((t) => t.clips.map((c) => `${c.id}@${c.timelineStartUs}`));
    expect(clipIds(d)).toEqual(["c@0", "d@12000000"]);

    d = documentReducer(d, { type: "undo" });
    expect(clipIds(d)).toEqual(["c@0", "d@4000000"]);
    d = documentReducer(d, { type: "undo" });
    expect(clipIds(d)).toEqual(["c@0"]);
    d = documentReducer(d, { type: "redo" });
    expect(clipIds(d)).toEqual(["c@0", "d@4000000"]);
  });

  it("uma edição nova descarta o que podia ser refeito", () => {
    let d = documentReducer(withVideo(), { type: "addClip", clipId: "c", mediaId: "v" });
    d = documentReducer(d, { type: "undo" });
    expect(canRedo(d)).toBe(true);
    d = documentReducer(d, { type: "rename", name: "Outro" });
    expect(canRedo(d)).toBe(false);
  });

  it("desfazer/refazer sem histórico não muda nada", () => {
    const d = initialDocument();
    expect(documentReducer(d, { type: "undo" })).toBe(d);
    expect(documentReducer(d, { type: "redo" })).toBe(d);
    expect(canUndo(d)).toBe(false);
  });

  it("edição recusada registra o motivo e não entra no histórico", () => {
    let d = documentReducer(withVideo(), { type: "addClip", clipId: "c", mediaId: "v", startUs: 0 });
    const before = d;
    d = documentReducer(d, { type: "addClip", clipId: "x", mediaId: "v", startUs: 1_000_000 });
    expect(d.project).toBe(before.project);
    expect(d.past).toBe(before.past);
    expect(d.lastError).toBe("o espaço na faixa já está ocupado");
    expect(documentReducer(d, { type: "clearError" }).lastError).toBeNull();
  });

  it("'não salvo' compara com a versão gravada: desfazer até ela limpa o indicador", () => {
    let d = withVideo();
    d = documentReducer(d, { type: "saved", project: d.project, filePath: "C:\\p.ncproj" });
    expect(d.dirty).toBe(false);
    d = documentReducer(d, { type: "addClip", clipId: "c", mediaId: "v" });
    expect(d.dirty).toBe(true);
    d = documentReducer(d, { type: "undo" });
    expect(d.dirty).toBe(false);
    d = documentReducer(d, { type: "undo" }); // volta para antes da importação
    expect(d.dirty).toBe(true);
  });

  it("o histórico é limitado", () => {
    let d = initialDocument();
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) d = documentReducer(d, { type: "rename", name: `n${i}` });
    expect(d.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("caminhos e nomes", () => {
  it("fileStem lida com barras e extensão em qualquer caixa", () => {
    expect(fileStem("C:\\Users\\G\\Meu filme.ncproj")).toBe("Meu filme");
    expect(fileStem("/tmp/a.b.NCPROJ")).toBe("a.b");
  });

  it("withProjectExtension só acrescenta quando falta", () => {
    expect(withProjectExtension("C:\\x\\projeto")).toBe("C:\\x\\projeto.ncproj");
    expect(withProjectExtension("C:\\x\\projeto.NCPROJ")).toBe("C:\\x\\projeto.NCPROJ");
  });

  it("prepareForSave adota o nome do arquivo só se o nome for o padrão", () => {
    const p = createEmptyProject(DEFAULT_PROJECT_NAME, NOW);
    const later = new Date("2026-10-18T13:00:00.000Z");
    const s = prepareForSave(p, "D:\\v\\Viagem.ncproj", later);
    expect(s.name).toBe("Viagem");
    expect(s.modifiedAt).toBe(later.toISOString());
    expect(s.createdAt).toBe(p.createdAt);
    expect(prepareForSave({ ...p, name: "Meu nome" }, "D:\\v\\Outro.ncproj").name).toBe("Meu nome");
  });

  it("título da janela indica alterações pendentes", () => {
    const d = initialDocument();
    expect(windowTitle(d)).toBe(`${DEFAULT_PROJECT_NAME} — NovaCut`);
    expect(windowTitle({ ...d, dirty: true })).toBe(`• ${DEFAULT_PROJECT_NAME} — NovaCut`);
  });
});
