import { describe, expect, it } from "vitest";
import { checkInvariants, clipDurationUs, clipEndUs, createEmptyProject } from "../project/project";
import type { MediaRef, Project } from "../project/schema";
import {
  addClip,
  DEFAULT_IMAGE_DURATION_US,
  defaultTrackFor,
  deleteClips,
  findClip,
  minClipDurationUs,
  moveClip,
  splitClip,
  trimClip,
  type OpResult,
} from "./ops";

const S = 1_000_000;

function media(id: string, kind: MediaRef["kind"], durationUs: number | null, hasAudio = kind !== "image"): MediaRef {
  return {
    id,
    kind,
    path: `C:\\m\\${id}`,
    name: id,
    durationUs,
    width: kind === "audio" ? null : 1920,
    height: kind === "audio" ? null : 1080,
    fps: kind === "video" ? 30 : null,
    hasVideo: kind !== "audio",
    hasAudio,
  };
}

/** Projeto com V2 (tracks[0]), V1 (tracks[1]), A1 (tracks[2]) e três mídias. */
function base(): Project {
  const p = createEmptyProject("t", new Date("2026-10-18T00:00:00Z"));
  p.tracks = p.tracks.map((t, i) => ({ ...t, id: ["v2", "v1", "a1"][i] }));
  p.media.push(media("vid", "video", 10 * S), media("aud", "audio", 6 * S), media("img", "image", null));
  return p;
}

function unwrap(r: OpResult): Project {
  if (!r.ok) throw new Error(r.error);
  expect(checkInvariants(r.project)).toEqual([]);
  return r.project;
}

const clip = (p: Project, id: string) => findClip(p, id)!.clip;

describe("addClip", () => {
  it("adiciona a mídia inteira no fim da faixa padrão", () => {
    let p = unwrap(addClip(base(), { clipId: "c1", mediaId: "vid" }));
    p = unwrap(addClip(p, { clipId: "c2", mediaId: "vid" }));
    expect(findClip(p, "c1")!.track.id).toBe("v1");
    expect(clip(p, "c1")).toMatchObject({ timelineStartUs: 0, sourceInUs: 0, sourceOutUs: 10 * S });
    expect(clip(p, "c2").timelineStartUs).toBe(10 * S);
  });

  it("áudio vai para A1 e imagem ganha duração padrão", () => {
    let p = unwrap(addClip(base(), { clipId: "a", mediaId: "aud" }));
    p = unwrap(addClip(p, { clipId: "i", mediaId: "img" }));
    expect(findClip(p, "a")!.track.id).toBe("a1");
    expect(clipDurationUs(clip(p, "i"))).toBe(DEFAULT_IMAGE_DURATION_US);
  });

  it("recusa sobreposição, faixa incompatível e trecho inválido", () => {
    const p = unwrap(addClip(base(), { clipId: "c1", mediaId: "vid", startUs: 0 }));
    expect(addClip(p, { clipId: "c2", mediaId: "vid", startUs: 5 * S })).toEqual({
      ok: false,
      error: "o espaço na faixa já está ocupado",
    });
    expect(addClip(p, { clipId: "c2", mediaId: "img", trackId: "a1" }).ok).toBe(false);
    expect(addClip(p, { clipId: "c2", mediaId: "vid", trackId: "v2", sourceInUs: 0, sourceOutUs: 11 * S }).ok).toBe(false);
    expect(addClip(p, { clipId: "c1", mediaId: "vid", trackId: "v2" }).ok).toBe(false); // id repetido
  });

  it("não altera o projeto original", () => {
    const p = base();
    const snapshot = JSON.stringify(p);
    addClip(p, { clipId: "c1", mediaId: "vid" });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("moveClip", () => {
  const two = () => {
    let p = unwrap(addClip(base(), { clipId: "c1", mediaId: "vid", startUs: 0, sourceOutUs: 2 * S }));
    p = unwrap(addClip(p, { clipId: "c2", mediaId: "vid", startUs: 5 * S, sourceOutUs: 2 * S }));
    return p;
  };

  it("move na mesma faixa e mantém a ordem por início", () => {
    const p = unwrap(moveClip(two(), "c1", { startUs: 8 * S }));
    expect(findClip(p, "c1")!.track.clips.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("move para outra faixa compatível", () => {
    const p = unwrap(moveClip(two(), "c1", { trackId: "v2", startUs: 1 * S }));
    expect(findClip(p, "c1")!.track.id).toBe("v2");
    expect(findClip(p, "c2")!.track.clips).toHaveLength(1);
  });

  it("vídeo com som pode ir para faixa de áudio; imagem não", () => {
    expect(moveClip(two(), "c1", { trackId: "a1", startUs: 0 }).ok).toBe(true);
    const p = unwrap(addClip(base(), { clipId: "i", mediaId: "img" }));
    expect(moveClip(p, "i", { trackId: "a1", startUs: 0 }).ok).toBe(false);
  });

  it("recusa sobreposição, mas permite encostar e limita em 0", () => {
    expect(moveClip(two(), "c1", { startUs: 4 * S }).ok).toBe(false);
    expect(clip(unwrap(moveClip(two(), "c1", { startUs: 3 * S })), "c1").timelineStartUs).toBe(3 * S);
    expect(moveClip(two(), "c2", { startUs: -5 * S }).ok).toBe(false); // limitado a 0, onde está c1
    const alone = unwrap(deleteClips(two(), ["c1"]));
    expect(clip(unwrap(moveClip(alone, "c2", { startUs: -5 * S })), "c2").timelineStartUs).toBe(0);
  });
});

describe("trimClip", () => {
  const one = () => unwrap(addClip(base(), { clipId: "c", mediaId: "vid", startUs: 2 * S, sourceInUs: 1 * S, sourceOutUs: 4 * S }));

  it("borda inicial avança início e sourceIn juntos, mantendo o fim", () => {
    const p = unwrap(trimClip(one(), "c", "start", 3 * S));
    expect(clip(p, "c")).toMatchObject({ timelineStartUs: 3 * S, sourceInUs: 2 * S, sourceOutUs: 4 * S });
  });

  it("borda inicial não recua além do início da mídia", () => {
    const p = unwrap(trimClip(one(), "c", "start", 0));
    expect(clip(p, "c")).toMatchObject({ timelineStartUs: 1 * S, sourceInUs: 0 });
  });

  it("borda final é limitada pela duração da mídia e pelo vizinho", () => {
    let p = unwrap(trimClip(one(), "c", "end", 60 * S));
    expect(clip(p, "c").sourceOutUs).toBe(10 * S);
    p = unwrap(addClip(one(), { clipId: "n", mediaId: "vid", startUs: 6 * S, sourceOutUs: S }));
    p = unwrap(trimClip(p, "c", "end", 60 * S));
    expect(clipEndUs(clip(p, "c"))).toBe(6 * S);
  });

  it("borda inicial é limitada pelo vizinho anterior", () => {
    let p = unwrap(addClip(one(), { clipId: "prev", mediaId: "vid", startUs: 0, sourceOutUs: 1.5 * S }));
    p = unwrap(trimClip(p, "c", "start", 0));
    expect(clip(p, "c").timelineStartUs).toBe(1.5 * S);
  });

  it("não deixa o clipe menor que um quadro", () => {
    const p = unwrap(trimClip(one(), "c", "end", 0));
    expect(clipDurationUs(clip(p, "c"))).toBe(minClipDurationUs(p));
  });
});

describe("splitClip", () => {
  it("divide em dois clipes contíguos que cobrem o trecho original", () => {
    const p0 = unwrap(addClip(base(), { clipId: "c", mediaId: "vid", startUs: S, sourceInUs: 2 * S, sourceOutUs: 8 * S }));
    const p = unwrap(splitClip(p0, "c", 3 * S, "d"));
    expect(clip(p, "c")).toMatchObject({ timelineStartUs: S, sourceInUs: 2 * S, sourceOutUs: 4 * S });
    expect(clip(p, "d")).toMatchObject({ timelineStartUs: 3 * S, sourceInUs: 4 * S, sourceOutUs: 8 * S });
    expect(clipEndUs(clip(p, "d"))).toBe(clipEndUs(clip(p0, "c")));
  });

  it("recusa ponto fora do clipe ou colado na borda", () => {
    const p = unwrap(addClip(base(), { clipId: "c", mediaId: "vid", startUs: 0 }));
    expect(splitClip(p, "c", 0, "d").ok).toBe(false);
    expect(splitClip(p, "c", 10 * S, "d").ok).toBe(false);
    expect(splitClip(p, "c", 20 * S, "d").ok).toBe(false);
    expect(splitClip(p, "c", 5 * S, "c").ok).toBe(false); // id repetido
  });

  it("propriedades são herdadas pelas duas partes", () => {
    const p0 = unwrap(addClip(base(), { clipId: "c", mediaId: "vid" }));
    p0.tracks[1].clips[0] = { ...p0.tracks[1].clips[0], volume: 0.5, brightness: 1.2 };
    const p = unwrap(splitClip(p0, "c", 4 * S, "d"));
    expect(clip(p, "d")).toMatchObject({ volume: 0.5, brightness: 1.2 });
  });
});

describe("deleteClips", () => {
  it("remove os clipes indicados e mantém a mídia na biblioteca", () => {
    let p = unwrap(addClip(base(), { clipId: "c1", mediaId: "vid" }));
    p = unwrap(addClip(p, { clipId: "c2", mediaId: "aud" }));
    p = unwrap(deleteClips(p, ["c1", "c2"]));
    expect(p.tracks.every((t) => t.clips.length === 0)).toBe(true);
    expect(p.media).toHaveLength(3);
    expect(deleteClips(p, ["nada"]).ok).toBe(false);
  });
});

describe("defaultTrackFor", () => {
  it("vídeo e imagem → V1 (faixa de vídeo mais baixa); áudio → A1", () => {
    const p = base();
    expect(defaultTrackFor(p, p.media[0])!.id).toBe("v1");
    expect(defaultTrackFor(p, p.media[2])!.id).toBe("v1");
    expect(defaultTrackFor(p, p.media[1])!.id).toBe("a1");
  });
});

describe("propriedade: edições aleatórias com velocidades variadas nunca violam invariantes", () => {
  // Gerador determinístico (LCG) para o teste ser reproduzível.
  function rng(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it("1000 operações em 10 sementes", () => {
    const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 1 / 3];
    for (let seed = 1; seed <= 10; seed++) {
      const r = rng(seed);
      let p = base();
      let n = 0;
      for (let step = 0; step < 100; step++) {
        const clips = p.tracks.flatMap((t) => t.clips);
        const pick = clips[Math.floor(r() * clips.length)];
        const t = Math.floor(r() * 30 * S);
        let res: OpResult;
        const op = r();
        if (op < 0.3 || !pick) {
          const m = p.media[Math.floor(r() * p.media.length)];
          res = addClip(p, { clipId: `c${n++}`, mediaId: m.id, startUs: r() < 0.5 ? undefined : t });
          if (res.ok) {
            // aplica uma velocidade arbitrária ao clipe novo, se couber
            const id = `c${n - 1}`;
            const loc = findClip(res.project, id)!;
            const sped = { ...loc.clip, speed: speeds[Math.floor(r() * speeds.length)] };
            const trial = {
              ...res.project,
              tracks: res.project.tracks.map((tr) =>
                tr.id === loc.track.id ? { ...tr, clips: tr.clips.map((c) => (c.id === id ? sped : c)) } : tr,
              ),
            };
            if (checkInvariants(trial).length === 0) res = { ok: true, project: trial };
          }
        } else if (op < 0.5) res = moveClip(p, pick.id, { startUs: t });
        else if (op < 0.7) res = trimClip(p, pick.id, r() < 0.5 ? "start" : "end", t);
        else if (op < 0.9) res = splitClip(p, pick.id, pick.timelineStartUs + Math.floor(r() * clipDurationUs(pick)), `c${n++}`);
        else res = deleteClips(p, [pick.id]);

        if (res.ok) {
          expect(checkInvariants(res.project), `semente ${seed}, passo ${step}`).toEqual([]);
          p = res.project;
        }
      }
    }
  });
});
