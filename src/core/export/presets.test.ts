import { describe, expect, it } from "vitest";
import { formatDuration, remainingMs, resolutionOptions, videoBitrateFor } from "./presets";

describe("resolutionOptions", () => {
  it("1080p oferece o projeto, 720p e 480p", () => {
    expect(resolutionOptions({ width: 1920, height: 1080 }).map((r) => `${r.width}x${r.height}`)).toEqual([
      "1920x1080",
      "1280x720",
      "854x480",
    ]);
  });

  it("vertical mantém a proporção pelo lado menor", () => {
    expect(resolutionOptions({ width: 1080, height: 1920 }).map((r) => `${r.width}x${r.height}`)).toEqual([
      "1080x1920",
      "720x1280",
      "480x854",
    ]);
  });

  it("4K inclui 1080p; dimensões sempre pares", () => {
    const opts = resolutionOptions({ width: 3840, height: 2160 });
    expect(opts.map((r) => r.height)).toEqual([2160, 1080, 720, 480]);
    expect(opts.every((r) => r.width % 2 === 0 && r.height % 2 === 0)).toBe(true);
  });
});

describe("taxa de bits", () => {
  it("proporcional à área, com mínimo", () => {
    expect(videoBitrateFor("alta", 1920, 1080)).toBe(16_000_000);
    expect(videoBitrateFor("media", 1280, 720)).toBe(4_400_000);
    expect(videoBitrateFor("leve", 320, 180)).toBe(1_000_000);
  });
});

describe("tempo restante", () => {
  it("estima pela velocidade média e não estima no começo", () => {
    expect(remainingMs(10_000, 0.25)).toBe(30_000);
    expect(remainingMs(500, 0.01)).toBeNull();
    expect(formatDuration(30_000)).toBe("30 s");
    expect(formatDuration(125_000)).toBe("2 min 05 s");
  });
});
