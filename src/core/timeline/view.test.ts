import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import {
  clampZoom,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  nearestSnap,
  pxToUs,
  snapMove,
  snapPoints,
  trackIndexAtY,
  usToPx,
  zoomAround,
  zoomToFit,
} from "./view";

const S = 1_000_000;

describe("conversões", () => {
  it("px ↔ µs", () => {
    expect(usToPx(2 * S, 60)).toBe(120);
    expect(pxToUs(90, 60)).toBe(1.5 * S);
    expect(pxToUs(1, 3)).toBe(333_333);
  });
});

describe("zoom", () => {
  it("limita o zoom", () => {
    expect(clampZoom(0.1)).toBe(MIN_PX_PER_SECOND);
    expect(clampZoom(1e6)).toBe(MAX_PX_PER_SECOND);
  });

  it("mantém o instante sob o ponteiro", () => {
    const pointerX = 300;
    const scrollLeft = 1200;
    const before = (scrollLeft + pointerX) / 60; // 25 s
    const z = zoomAround(60, 2, scrollLeft, pointerX);
    expect(z.pxPerSecond).toBe(120);
    expect((z.scrollLeft + pointerX) / z.pxPerSecond).toBeCloseTo(before);
  });

  it("não rola para antes do início", () => {
    expect(zoomAround(60, 0.5, 0, 100).scrollLeft).toBe(0);
  });

  it("encaixa a duração na largura", () => {
    expect(zoomToFit(10 * S, 1000)).toBeCloseTo(95);
    expect(zoomToFit(0, 1000)).toBe(60);
  });
});

describe("snapping", () => {
  it("encontra o ponto mais próximo dentro do limite", () => {
    expect(nearestSnap(1_050_000, [0, S, 2 * S], 100_000)).toBe(S);
    expect(nearestSnap(1_500_000, [0, S, 2 * S], 100_000)).toBeNull();
  });

  it("move encaixando pela borda mais próxima (início ou fim)", () => {
    const pts = [0, 5 * S, 10 * S];
    // início perto de 5 s
    expect(snapMove(5_060_000, 2 * S, pts, 100_000)).toEqual({ startUs: 5 * S, snappedAt: 5 * S });
    // fim (start + 2 s) perto de 10 s
    expect(snapMove(7_950_000, 2 * S, pts, 100_000)).toEqual({ startUs: 8 * S, snappedAt: 10 * S });
    // nada perto
    expect(snapMove(3 * S, 1 * S, pts, 100_000)).toEqual({ startUs: 3 * S, snappedAt: null });
    // nunca antes de 0
    expect(snapMove(-5 * S, 1 * S, pts, 100_000).startUs).toBe(0);
  });

  it("pontos incluem 0, playhead e bordas, exceto clipes ignorados", () => {
    const p = createEmptyProject();
    p.media.push({
      id: "m",
      kind: "video",
      path: "m.mp4",
      name: "m",
      durationUs: 10 * S,
      width: 1,
      height: 1,
      fps: 30,
      hasVideo: true,
      hasAudio: false,
    });
    const c = (id: string, start: number) => ({
      id,
      mediaId: "m",
      timelineStartUs: start,
      sourceInUs: 0,
      sourceOutUs: S,
      speed: 1,
      volume: 1,
      brightness: 1,
      contrast: 1,
    });
    p.tracks[1].clips.push(c("a", 2 * S), c("b", 5 * S));
    expect(snapPoints(p, 7 * S)).toEqual([0, 2 * S, 3 * S, 5 * S, 6 * S, 7 * S]);
    expect(snapPoints(p, 7 * S, new Set(["a"]))).toEqual([0, 5 * S, 6 * S, 7 * S]);
  });
});

describe("trackIndexAtY", () => {
  it("mapeia a altura para o índice da faixa", () => {
    expect(trackIndexAtY(0, 52, 3)).toBe(0);
    expect(trackIndexAtY(53, 52, 3)).toBe(1);
    expect(trackIndexAtY(200, 52, 3)).toBeNull();
    expect(trackIndexAtY(-1, 52, 3)).toBeNull();
  });
});
