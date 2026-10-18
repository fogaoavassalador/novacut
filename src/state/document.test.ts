import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../core/project/project";
import type { MediaRef } from "../core/project/schema";
import {
  DEFAULT_PROJECT_NAME,
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
    expect(loaded).toEqual({ project: p, filePath: "a.ncproj", dirty: false });
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
    expect(documentReducer(removed, { type: "removeMedia", mediaId: "b" })).toBe(removed);
    expect(documentReducer(removed, { type: "removeMedia", mediaId: "nao-existe" })).toBe(removed);
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
