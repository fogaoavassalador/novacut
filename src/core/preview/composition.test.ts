import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import type { Clip, MediaRef, Project } from "../project/schema";
import {
  activeClipsAt,
  audioSourcesAt,
  clipsToMount,
  cssFilter,
  needsSeek,
  planElement,
  sourceTimeAt,
  visualLayersAt,
} from "./composition";

const S = 1_000_000;

const media = (id: string, kind: MediaRef["kind"], hasAudio: boolean): MediaRef => ({
  id,
  kind,
  path: id,
  name: id,
  durationUs: kind === "image" ? null : 60 * S,
  width: kind === "audio" ? null : 100,
  height: kind === "audio" ? null : 100,
  fps: kind === "video" ? 30 : null,
  hasVideo: kind !== "audio",
  hasAudio,
});

const clip = (id: string, mediaId: string, start: number, inUs: number, outUs: number, over: Partial<Clip> = {}): Clip => ({
  id,
  mediaId,
  timelineStartUs: start,
  sourceInUs: inUs,
  sourceOutUs: outUs,
  speed: 1,
  volume: 1,
  brightness: 1,
  contrast: 1,
  ...over,
});

/** V2: logo 2–4 s · V1: vid 0–10 s · A1: música 1–5 s */
function project(): Project {
  const p = createEmptyProject();
  p.media.push(media("vid", "video", true), media("logo", "image", false), media("mus", "audio", true));
  p.tracks[0].clips.push(clip("logo", "logo", 2 * S, 0, 2 * S));
  p.tracks[1].clips.push(clip("main", "vid", 0, 5 * S, 15 * S));
  p.tracks[2].clips.push(clip("music", "mus", 1 * S, 0, 4 * S));
  return p;
}

describe("sourceTimeAt", () => {
  it("considera o ponto de entrada e a velocidade", () => {
    expect(sourceTimeAt(clip("c", "vid", 2 * S, 10 * S, 20 * S), 3 * S)).toBe(11 * S);
    expect(sourceTimeAt(clip("c", "vid", 2 * S, 10 * S, 20 * S, { speed: 2 }), 3 * S)).toBe(12 * S);
    expect(sourceTimeAt(clip("c", "vid", 0, 0, 4 * S, { speed: 0.5 }), 3 * S)).toBe(1.5 * S);
  });
});

describe("clipes ativos", () => {
  it("intervalo é [início, fim)", () => {
    const p = project();
    expect(activeClipsAt(p, 2 * S).map((a) => a.clip.id)).toEqual(["logo", "main", "music"]);
    expect(activeClipsAt(p, 4 * S).map((a) => a.clip.id)).toEqual(["main", "music"]); // logo termina em 4 s
    expect(activeClipsAt(p, 10 * S)).toEqual([]);
  });

  it("calcula a posição na mídia de cada clipe", () => {
    const at = activeClipsAt(project(), 3 * S);
    expect(at.find((a) => a.clip.id === "main")!.sourceUs).toBe(8 * S);
    expect(at.find((a) => a.clip.id === "logo")!.sourceUs).toBe(1 * S);
  });
});

describe("camadas e som", () => {
  it("camadas vão de V1 (baixo) para o topo", () => {
    expect(visualLayersAt(project(), 3 * S).map((a) => a.clip.id)).toEqual(["main", "logo"]);
  });

  it("faixa oculta não aparece; faixa muda não toca", () => {
    const p = project();
    p.tracks[0].hidden = true;
    p.tracks[2].muted = true;
    expect(visualLayersAt(p, 3 * S).map((a) => a.clip.id)).toEqual(["main"]);
    expect(audioSourcesAt(p, 3 * S).map((a) => a.clip.id)).toEqual(["main"]);
  });

  it("imagem não tem som; vídeo e áudio têm", () => {
    expect(audioSourcesAt(project(), 3 * S).map((a) => a.clip.id)).toEqual(["main", "music"]);
  });
});

describe("pré-carregamento", () => {
  it("monta clipes ativos e os que começam dentro da janela", () => {
    const p = project();
    expect(clipsToMount(p, 0.5 * S, 1 * S).map((a) => a.clip.id)).toEqual(["main", "music"]);
    expect(clipsToMount(p, 0.5 * S, 2 * S).map((a) => a.clip.id)).toEqual(["logo", "main", "music"]);
    expect(clipsToMount(p, 6 * S, 2 * S).map((a) => a.clip.id)).toEqual(["main"]);
  });
});

describe("ajustes e sincronia", () => {
  it("filtro CSS só quando há ajuste", () => {
    expect(cssFilter({ brightness: 1, contrast: 1 })).toBe("none");
    expect(cssFilter({ brightness: 1.1, contrast: 1.2 })).toBe("brightness(1.1) contrast(1.2)");
  });

  it("plano do elemento: pré-carrega no início, sincroniza quando ativo", () => {
    const c = clip("c", "vid", 2 * S, 10 * S, 20 * S);
    const frame = 33_333;
    // pré-carregando: pausado no sourceIn
    expect(planElement({ clip: c, t: 1 * S, active: false, playing: true, actualUs: 0, frameUs: frame })).toEqual({
      play: false,
      seekToUs: 10 * S,
    });
    // ativo e tocando, já sincronizado: só tocar
    expect(planElement({ clip: c, t: 3 * S, active: true, playing: true, actualUs: 11.05 * S, frameUs: frame })).toEqual({
      play: true,
      seekToUs: null,
    });
    // ativo e parado, fora do quadro: seek exato
    expect(planElement({ clip: c, t: 3 * S, active: true, playing: false, actualUs: 10 * S, frameUs: frame })).toEqual({
      play: false,
      seekToUs: 11 * S,
    });
  });

  it("parado: corrige acima de meio quadro; tocando: só acima da tolerância", () => {
    const frame = 33_333;
    expect(needsSeek(1_000_000, 1_020_000, false, frame)).toBe(true);
    expect(needsSeek(1_000_000, 1_010_000, false, frame)).toBe(false);
    expect(needsSeek(1_000_000, 1_100_000, true, frame)).toBe(false);
    expect(needsSeek(1_000_000, 1_200_000, true, frame)).toBe(true);
  });
});
