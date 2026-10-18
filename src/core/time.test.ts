import { describe, expect, it } from "vitest";
import {
  formatTimecode,
  frameToMicros,
  microsToFrame,
  microsToSeconds,
  secondsToMicros,
  snapToFrame,
} from "./time";

describe("conversão segundos ↔ µs", () => {
  it("converte e arredonda para inteiro", () => {
    expect(secondsToMicros(1.5)).toBe(1_500_000);
    expect(secondsToMicros(0.1 + 0.2)).toBe(300_000);
    expect(microsToSeconds(2_500_000)).toBe(2.5);
  });

  it("rejeita valores não finitos", () => {
    expect(() => secondsToMicros(Number.NaN)).toThrow(RangeError);
    expect(() => secondsToMicros(Infinity)).toThrow(RangeError);
  });
});

describe("frames", () => {
  it("frame ↔ µs em 30 fps é exato", () => {
    expect(frameToMicros(30, 30)).toBe(1_000_000);
    expect(microsToFrame(1_000_000, 30)).toBe(30);
    expect(microsToFrame(999_999, 30)).toBe(29);
  });

  it("ida e volta em 29.97 fps não perde frame", () => {
    const fps = 30000 / 1001;
    for (let f = 0; f < 5000; f += 37) {
      expect(microsToFrame(frameToMicros(f, fps), fps)).toBe(f);
    }
  });

  it("snap alinha ao frame mais próximo", () => {
    expect(snapToFrame(1_010_000, 30)).toBe(1_000_000);
    expect(snapToFrame(1_020_000, 30)).toBe(frameToMicros(31, 30));
  });

  it("rejeita fps inválido", () => {
    expect(() => frameToMicros(1, 0)).toThrow(RangeError);
    expect(() => microsToFrame(1, -24)).toThrow(RangeError);
  });
});

describe("timecode", () => {
  it("formata HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(secondsToMicros(61.5), 30)).toBe("00:01:01:15");
    expect(formatTimecode(secondsToMicros(3600), 25)).toBe("01:00:00:00");
  });

  it("valores negativos recebem sinal", () => {
    expect(formatTimecode(-1_000_000, 30)).toBe("-00:00:01:00");
  });
});
