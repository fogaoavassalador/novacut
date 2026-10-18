/**
 * Integração com o FFmpeg real: gera mídias sintéticas, exporta um projeto com
 * o comando de buildExportPlan e inspeciona pixels e níveis de áudio do MP4.
 * Ignorado (com aviso) se não houver ffmpeg/ffprobe no PATH.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import type { Clip, MediaRef, Project } from "../project/schema";
import { buildExportPlan } from "./ffmpegArgs";

const S = 1_000_000;
const W = 320;
const H = 180;

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const available = hasFfmpeg();
if (!available) console.warn("FFmpeg ausente: teste de integração da exportação ignorado");

const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

let dir = "";
let output = "";

function mediaRef(id: string, path: string, kind: MediaRef["kind"], w: number | null, h: number | null, hasAudio: boolean): MediaRef {
  return { id, kind, path, name: id, durationUs: kind === "image" ? null : 10 * S, width: w, height: h, fps: kind === "video" ? 30 : null, hasVideo: kind !== "audio", hasAudio };
}
const clip = (id: string, mediaId: string, start: number, inUs: number, outUs: number, over: Partial<Clip> = {}): Clip => ({
  id, mediaId, timelineStartUs: start, sourceInUs: inUs, sourceOutUs: outUs, speed: 1, volume: 1, brightness: 1, contrast: 1, ...over,
});

/** Pixel RGB do quadro em `t` segundos, na posição (x, y). */
function pixel(t: number, x: number, y: number): [number, number, number] {
  const raw = join(dir, "px.raw");
  ff(["-ss", String(t), "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const b = readFileSync(raw);
  const i = (y * W + x) * 3;
  return [b[i], b[i + 1], b[i + 2]];
}

describe.runIf(available)("exportação real com FFmpeg", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "novacut-export-"));
    ff(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=10", "-c:v", "libopenh264", join(dir, "red.mp4")]);
    ff(["-f", "lavfi", "-i", "color=c=blue:s=90x160:r=30:d=10", "-c:v", "libopenh264", join(dir, "blue_vertical.mp4")]);
    ff(["-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:r=30:d=10", "-c:v", "libopenh264", join(dir, "green.mp4")]);
    ff(["-f", "lavfi", "-i", "color=c=0x808080:s=64x64", "-frames:v", "1", join(dir, "gray.png")]);
    ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=10", join(dir, "tone.wav")]);

    const p: Project = createEmptyProject("integração");
    p.settings = { ...p.settings, width: W, height: H, fps: 30 };
    p.media.push(
      mediaRef("red", join(dir, "red.mp4"), "video", 320, 180, false),
      mediaRef("blue", join(dir, "blue_vertical.mp4"), "video", 90, 160, false),
      mediaRef("green", join(dir, "green.mp4"), "video", 320, 180, false),
      mediaRef("gray", join(dir, "gray.png"), "image", 64, 64, false),
      mediaRef("tone", join(dir, "tone.wav"), "audio", null, null, true),
    );
    // V1: vermelho 0–4 s · cinza (brilho 1,1, contraste 1,2) 4–5 s · verde a 2× 5–6 s
    p.tracks[1].clips.push(
      clip("r", "red", 0, 0, 4 * S),
      clip("g", "gray", 4 * S, 0, 1 * S, { brightness: 1.1, contrast: 1.2 }),
      clip("gr", "green", 5 * S, 0, 2 * S, { speed: 2 }),
    );
    // V2: azul vertical 1–2 s (centralizado, sem cobrir as laterais)
    p.tracks[0].clips.push(clip("b", "blue", 1 * S, 0, 1 * S));
    // A1: tom a 100% em 1–2 s e a 200% em 3–4 s
    p.tracks[2].clips.push(clip("t1", "tone", 1 * S, 0, 1 * S), clip("t2", "tone", 3 * S, 0, 1 * S, { volume: 2 }));

    output = join(dir, "saída final.mp4");
    const plan = buildExportPlan(p, { outputPath: output, encoder: "libopenh264", videoBitrate: 2_000_000, audioBitrate: 128_000 });
    execFileSync("ffmpeg", plan.args, { stdio: ["ignore", "ignore", "pipe"] });
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("gera MP4 H.264 + AAC com a duração do projeto e a resolução pedida", () => {
    const info = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", output]).toString(),
    );
    const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const a = info.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    expect(v.codec_name).toBe("h264");
    expect([v.width, v.height]).toEqual([W, H]);
    expect(v.avg_frame_rate).toBe("30/1");
    expect(a.codec_name).toBe("aac");
    expect(Number(info.format.duration)).toBeCloseTo(6, 1);
  });

  it("camadas, ajuste centralizado, brilho/contraste e velocidade", () => {
    const near = (px: number[], rgb: number[], tol = 24) => px.every((c, i) => Math.abs(c - rgb[i]) <= tol);
    expect(near(pixel(0.5, 160, 90), [255, 0, 0])).toBe(true); // V1 vermelho
    expect(near(pixel(1.5, 160, 90), [0, 0, 255])).toBe(true); // V2 azul no centro…
    expect(near(pixel(1.5, 10, 90), [255, 0, 0])).toBe(true); // …sem cobrir as laterais
    expect(near(pixel(2.5, 160, 90), [255, 0, 0])).toBe(true); // V2 já terminou
    const gray = pixel(4.5, 160, 90);
    expect(Math.abs(gray[0] - 143)).toBeLessThanOrEqual(4); // (0,502·1,1 − 0,5)·1,2 + 0,5 ≈ 0,56 → 143
    expect(near(pixel(5.5, 160, 90), [0, 255, 0])).toBe(true); // verde a 2× ocupa 5–6 s
  });

  it("áudio: silêncio fora dos clipes, tom no lugar certo e +6 dB a 200%", () => {
    const silence = meanVolumeStderr(0, 1);
    const v100 = meanVolumeStderr(1, 2);
    const gap = meanVolumeStderr(2, 3);
    const v200 = meanVolumeStderr(3, 4);
    expect(silence).toBeLessThan(-80);
    expect(gap).toBeLessThan(-80);
    expect(v100).toBeGreaterThan(-40);
    expect(v200 - v100).toBeGreaterThan(5.5);
    expect(v200 - v100).toBeLessThan(6.5);
  });
});

/** volumedetect escreve no stderr: lê o stderr de um processo que termina com sucesso. */
function meanVolumeStderr(a: number, b: number): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", output, "-af", `atrim=${a}:${b},volumedetect`, "-f", "null", "-"], { encoding: "utf8" });
  return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr)?.[1] ?? NaN);
}

