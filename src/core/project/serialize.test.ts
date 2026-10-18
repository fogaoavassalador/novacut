import { describe, expect, it } from "vitest";
import { checkInvariants, clipDurationUs, createEmptyProject, projectDurationUs } from "./project";
import type { Clip, MediaRef, Project } from "./schema";
import { parseProject, serializeProject } from "./serialize";

const NOW = new Date("2026-10-18T12:00:00.000Z");

function video(id: string, durationUs = 10_000_000): MediaRef {
  return {
    id,
    kind: "video",
    path: `C:\\midia\\${id}.mp4`,
    name: `${id}.mp4`,
    durationUs,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
  };
}

function clip(id: string, mediaId: string, startUs: number, inUs = 0, outUs = 2_000_000): Clip {
  return {
    id,
    mediaId,
    timelineStartUs: startUs,
    sourceInUs: inUs,
    sourceOutUs: outUs,
    speed: 1,
    volume: 1,
    brightness: 1,
    contrast: 1,
  };
}

function sampleProject(): Project {
  const p = createEmptyProject("Teste", NOW);
  p.media.push(video("m1"), {
    id: "img",
    kind: "image",
    path: "C:\\midia\\logo.png",
    name: "logo.png",
    durationUs: null,
    width: 512,
    height: 512,
    fps: null,
    hasVideo: true,
    hasAudio: false,
  });
  p.tracks[1].clips.push(clip("c1", "m1", 0), clip("c2", "m1", 2_000_000, 4_000_000, 6_000_000));
  p.tracks[0].clips.push(clip("c3", "img", 1_000_000, 0, 3_000_000));
  return p;
}

const issuesOf = (text: string) => {
  const r = parseProject(text);
  return r.ok ? [] : r.issues.map((i) => i.message).join(" | ");
};

describe("createEmptyProject", () => {
  it("cria um projeto válido com 2 faixas de vídeo e 1 de áudio", () => {
    const p = createEmptyProject("X", NOW);
    expect(p.tracks.map((t) => t.kind)).toEqual(["video", "video", "audio"]);
    expect(p.createdAt).toBe("2026-10-18T12:00:00.000Z");
    expect(checkInvariants(p)).toEqual([]);
    expect(parseProject(serializeProject(p)).ok).toBe(true);
  });
});

describe("ida e volta", () => {
  it("serializar e ler devolve exatamente o mesmo projeto", () => {
    const p = sampleProject();
    const r = parseProject(serializeProject(p));
    expect(r).toEqual({ ok: true, project: p });
  });

  it("é estável: serializar duas vezes gera o mesmo texto", () => {
    const text = serializeProject(sampleProject());
    const r = parseProject(text);
    if (!r.ok) throw new Error("falhou");
    expect(serializeProject(r.project)).toBe(text);
  });
});

describe("rejeições", () => {
  it("JSON quebrado", () => {
    expect(issuesOf("{ nao é json")).toMatch(/JSON inválido/);
  });

  it("outro tipo de arquivo", () => {
    expect(issuesOf(JSON.stringify({ hello: 1 }))).toMatch(/não é um projeto NovaCut/);
    expect(issuesOf("[]")).toMatch(/não contém um objeto/);
  });

  it("versão mais nova que a suportada", () => {
    const p = { ...sampleProject(), formatVersion: 99 };
    expect(issuesOf(JSON.stringify(p))).toMatch(/versão mais nova.*formato 99/);
  });

  it("versão ausente", () => {
    const { formatVersion: _omit, ...rest } = sampleProject();
    expect(issuesOf(JSON.stringify(rest))).toMatch(/versão do formato/);
  });

  it("tempo não inteiro é recusado pelo schema", () => {
    const p = sampleProject();
    p.tracks[1].clips[0].timelineStartUs = 1.5;
    const r = parseProject(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toBe("tracks.1.clips.0.timelineStartUs");
  });
});

describe("invariantes", () => {
  it("clipes sobrepostos na mesma faixa", () => {
    const p = sampleProject();
    p.tracks[1].clips[1].timelineStartUs = 1_500_000;
    expect(issuesOf(JSON.stringify(p))).toMatch(/se sobrepõem/);
  });

  it("clipes encostados não se sobrepõem", () => {
    const p = sampleProject(); // c1 termina em 2 s, c2 começa em 2 s
    expect(checkInvariants(p)).toEqual([]);
  });

  it("mídia inexistente", () => {
    const p = sampleProject();
    p.tracks[1].clips[0].mediaId = "fantasma";
    expect(issuesOf(JSON.stringify(p))).toMatch(/mídia "fantasma" não existe/);
  });

  it("ids duplicados", () => {
    const p = sampleProject();
    p.tracks[0].clips[0].id = "c1";
    expect(issuesOf(JSON.stringify(p))).toMatch(/id duplicado "c1"/);
  });

  it("intervalo de origem vazio ou invertido", () => {
    const p = sampleProject();
    p.tracks[1].clips[0].sourceOutUs = 0;
    expect(issuesOf(JSON.stringify(p))).toMatch(/sourceOutUs deve ser maior/);
  });

  it("trecho além da duração da mídia", () => {
    const p = sampleProject();
    p.tracks[1].clips[1].sourceOutUs = 11_000_000;
    expect(issuesOf(JSON.stringify(p))).toMatch(/ultrapassa a duração/);
  });

  it("imagem em faixa de áudio", () => {
    const p = sampleProject();
    p.tracks[2].clips.push(clip("c9", "img", 0, 0, 1_000_000));
    expect(issuesOf(JSON.stringify(p))).toMatch(/image não cabe em faixa de audio/);
  });

  it("vídeo com som cabe em faixa de áudio", () => {
    const p = sampleProject();
    p.tracks[2].clips.push(clip("c9", "m1", 0));
    expect(checkInvariants(p)).toEqual([]);
  });
});

describe("durações", () => {
  it("velocidade 2x reduz a duração pela metade", () => {
    const c = { ...clip("c", "m1", 0, 0, 4_000_000), speed: 2 };
    expect(clipDurationUs(c)).toBe(2_000_000);
  });

  it("duração do projeto é o fim do último clipe", () => {
    expect(projectDurationUs(sampleProject())).toBe(4_000_000);
  });
});
