import { describe, expect, it } from "vitest";
import { chooseMajorStepSeconds, rulerTicks } from "./ruler";

describe("chooseMajorStepSeconds", () => {
  it("usa passos maiores quando o zoom diminui", () => {
    expect(chooseMajorStepSeconds(200)).toBe(0.5);
    expect(chooseMajorStepSeconds(100)).toBe(1);
    expect(chooseMajorStepSeconds(20)).toBe(5);
    expect(chooseMajorStepSeconds(1)).toBe(120);
  });

  it("rejeita zoom inválido", () => {
    expect(() => chooseMajorStepSeconds(0)).toThrow(RangeError);
  });
});

describe("rulerTicks", () => {
  it("gera marcas principais a cada passo e menores entre elas", () => {
    const ticks = rulerTicks(0, 200, 100); // 2 s visíveis, passo principal de 1 s
    const majors = ticks.filter((t) => t.major).map((t) => t.timeUs);
    expect(majors).toEqual([0, 1_000_000, 2_000_000]);
    expect(ticks).toHaveLength(11); // 0..2 s em passos de 0,2 s
    expect(ticks[1]).toMatchObject({ timeUs: 200_000, x: 20, major: false });
  });

  it("respeita o deslocamento de rolagem", () => {
    const ticks = rulerTicks(1_100_000, 50, 100);
    expect(ticks[0]).toMatchObject({ timeUs: 1_200_000, major: false });
    expect(ticks[0].x).toBeCloseTo(10);
  });

  it("largura zero não gera marcas", () => {
    expect(rulerTicks(0, 0, 100)).toEqual([]);
  });
});
