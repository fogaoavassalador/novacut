import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import type { Project } from "../project/schema";
import { clipsSplittableAt, nextSelection, pruneSelection, splitTargets } from "./selection";

const S = 1_000_000;

function project(): Project {
  const p = createEmptyProject();
  p.media.push({
    id: "m",
    kind: "video",
    path: "m.mp4",
    name: "m",
    durationUs: 60 * S,
    width: 1,
    height: 1,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
  });
  const c = (id: string, start: number, dur: number) => ({
    id,
    mediaId: "m",
    timelineStartUs: start,
    sourceInUs: 0,
    sourceOutUs: dur,
    speed: 1,
    volume: 1,
    brightness: 1,
    contrast: 1,
  });
  p.tracks[0].clips.push(c("top", 2 * S, 4 * S)); // 2–6 s
  p.tracks[1].clips.push(c("main", 0, 10 * S)); // 0–10 s
  p.tracks[2].clips.push(c("aud", 5 * S, 2 * S)); // 5–7 s
  return p;
}

describe("divisão no playhead", () => {
  it("encontra os clipes sob o ponto, longe das bordas", () => {
    expect(clipsSplittableAt(project(), 3 * S).map((c) => c.id)).toEqual(["top", "main"]);
    expect(clipsSplittableAt(project(), 2 * S).map((c) => c.id)).toEqual(["main"]); // borda de "top"
  });

  it("prefere os selecionados; sem seleção sob o playhead, divide todos", () => {
    const p = project();
    expect(splitTargets(p, new Set(["main"]), 5.5 * S).map((c) => c.id)).toEqual(["main"]);
    expect(splitTargets(p, new Set(), 5.5 * S).map((c) => c.id)).toEqual(["top", "main", "aud"]);
    expect(splitTargets(p, new Set(["aud"]), 3 * S).map((c) => c.id)).toEqual(["top", "main"]);
  });
});

describe("seleção", () => {
  it("clique simples seleciona só um; aditivo alterna", () => {
    let s = nextSelection(new Set(), "a", false);
    expect([...s]).toEqual(["a"]);
    s = nextSelection(s, "b", true);
    expect([...s].sort()).toEqual(["a", "b"]);
    s = nextSelection(s, "a", true);
    expect([...s]).toEqual(["b"]);
    expect([...nextSelection(s, "c", false)]).toEqual(["c"]);
  });

  it("remove ids que sumiram e preserva a referência quando nada muda", () => {
    const p = project();
    const sel = new Set(["main", "fantasma"]);
    expect([...pruneSelection(p, sel)]).toEqual(["main"]);
    const ok = new Set(["main"]);
    expect(pruneSelection(p, ok)).toBe(ok);
  });
});
