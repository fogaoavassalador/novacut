import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import type { Clip, MediaRef, Project } from "../project/schema";
import { atempoChain, buildExportPlan, lutExpr, sec } from "./ffmpegArgs";

const S = 1_000_000;
const OPTS = { outputPath: "C:\\saida\\filme.mp4", encoder: "libopenh264" as const, videoBitrate: 8_000_000, audioBitrate: 192_000 };

const media = (id: string, kind: MediaRef["kind"], hasAudio = kind !== "image"): MediaRef => ({
  id,
  kind,
  path: `C:\\m\\${id} com espaço;[x].mp4`,
  name: id,
  durationUs: kind === "image" ? null : 60 * S,
  width: 100,
  height: 100,
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

function project(): Project {
  const p = createEmptyProject();
  p.media.push(media("vid", "video"), media("logo", "image"), media("mus", "audio"));
  p.tracks[0].clips.push(clip("top", "logo", 1 * S, 0, 2 * S, { brightness: 1.1, contrast: 1.2 }));
  p.tracks[1].clips.push(clip("main", "vid", 0, 5 * S, 9 * S, { speed: 2 }));
  p.tracks[2].clips.push(clip("music", "mus", 0.5 * S, 0, 3 * S, { volume: 1.5 }));
  return p;
}

const filterOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("utilitários", () => {
  it("sec usa 6 casas e nunca notação exponencial", () => {
    expect(sec(1_500_000)).toBe("1.500000");
    expect(sec(1)).toBe("0.000001");
  });

  it("atempo: dentro da faixa é um estágio; abaixo de 0,5 encadeia", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(2)).toEqual(["atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(0.1)).toEqual(["atempo=0.5", "atempo=0.5", "atempo=0.5", "atempo=0.8"]);
    expect(() => atempoChain(0)).toThrow(RangeError);
  });

  it("expressão do lutrgb segue a fórmula do CSS", () => {
    expect(lutExpr(1.1, 1.2)).toBe("clip(((val/maxval)*1.1-0.5)*1.2+0.5,0,1)*maxval");
  });
});

describe("buildExportPlan", () => {
  it("uma entrada por clipe, com busca e duração do trecho; imagem em loop", () => {
    const { args } = buildExportPlan(project(), OPTS);
    const inputPaths = args.flatMap((a, i) => (a === "-i" ? [args[i + 1]] : []));
    // V1 (camada de baixo) primeiro, depois V2, depois o áudio
    expect(inputPaths).toEqual(["C:\\m\\vid com espaço;[x].mp4", "C:\\m\\logo com espaço;[x].mp4", "C:\\m\\mus com espaço;[x].mp4"]);
    const first = args.indexOf("-i");
    expect(args.slice(first - 4, first)).toEqual(["-ss", "5.000000", "-t", "4.000000"]);
    const loopAt = args.indexOf("-loop");
    expect(args.slice(loopAt, loopAt + 8)).toEqual(["-loop", "1", "-framerate", "30", "-t", "2.000000", "-i", "C:\\m\\logo com espaço;[x].mp4"]);
  });

  it("caminhos nunca aparecem dentro do filtro", () => {
    const { args } = buildExportPlan(project(), OPTS);
    expect(filterOf(args)).not.toMatch(/C:\\m/);
  });

  it("camadas de baixo para cima, velocidade, ajustes e posição no tempo", () => {
    const f = filterOf(buildExportPlan(project(), OPTS).args);
    expect(f.indexOf("[0:v]")).toBeLessThan(f.indexOf("[1:v]")); // V1 antes de V2
    expect(f).toContain("[0:v]setpts=(PTS-STARTPTS)/2,fps=30");
    expect(f).toContain("lutrgb=r='clip(((val/maxval)*1.1-0.5)*1.2+0.5,0,1)*maxval'");
    expect(f).toContain("setpts=PTS+1.000000/TB");
    expect(f).toContain("enable='between(t,1.000000,3.000000)'");
    expect(f).toContain("color=c=0x000000:s=1920x1080:r=30:d=3.500000[base]");
  });

  it("áudio: atraso, volume e mix sem normalizar", () => {
    const f = filterOf(buildExportPlan(project(), OPTS).args);
    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS,atempo=2,volume=1"); // som do vídeo a 2×
    expect(f).toContain("volume=1.5");
    expect(f).toContain("adelay=500|500");
    expect(f).toContain("amix=inputs=3:duration=first:normalize=0");
  });

  it("faixa oculta sai do vídeo; faixa muda sai do áudio", () => {
    const p = project();
    p.tracks[0].hidden = true;
    p.tracks[2].muted = true;
    const plan = buildExportPlan(p, OPTS);
    expect(plan.videoLayers).toBe(1);
    expect(plan.audioSources).toBe(1); // só o som do vídeo
  });

  it("projeto só com imagem gera trilha de silêncio", () => {
    const p = createEmptyProject();
    p.media.push(media("logo", "image"));
    p.tracks[1].clips.push(clip("i", "logo", 0, 0, 2 * S));
    expect(filterOf(buildExportPlan(p, OPTS).args)).toContain("[asil]anull[aout]");
  });

  it("saída, encoder, progresso legível e duração", () => {
    const { args, durationUs } = buildExportPlan(project(), OPTS);
    expect(durationUs).toBe(3.5 * S);
    expect(args[args.length - 1]).toBe(OPTS.outputPath);
    expect(args).toEqual(expect.arrayContaining(["-c:v", "libopenh264", "-progress", "pipe:1", "-t", "3.500000"]));
  });

  it("recusa timeline vazia e resolução ímpar", () => {
    expect(() => buildExportPlan(createEmptyProject(), OPTS)).toThrow(/vazia/);
    expect(() => buildExportPlan(project(), { ...OPTS, width: 1921 })).toThrow(/pares/);
  });
});
