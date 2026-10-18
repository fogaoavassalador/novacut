import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/project";
import type { MediaRef } from "../project/schema";
import {
  fileName,
  findMediaByPath,
  isMediaInUse,
  mediaRefFromProbe,
  pathKey,
  thumbnailTimeUs,
  type MediaProbe,
} from "./media";

const probe = (over: Partial<MediaProbe> = {}): MediaProbe => ({
  kind: "video",
  durationUs: 3_000_000,
  width: 640,
  height: 360,
  fps: 25,
  rotation: 0,
  hasVideo: true,
  hasAudio: true,
  videoCodec: "h264",
  audioCodec: "aac",
  sampleRate: 44100,
  channels: 1,
  container: "mov,mp4",
  ...over,
});

describe("mediaRefFromProbe", () => {
  it("converte vídeo mantendo duração, dimensões e fps", () => {
    const m = mediaRefFromProbe(probe(), "C:\\clips\\Praia 01.mp4", "m1");
    expect(m).toEqual({
      id: "m1",
      kind: "video",
      path: "C:\\clips\\Praia 01.mp4",
      name: "Praia 01.mp4",
      durationUs: 3_000_000,
      width: 640,
      height: 360,
      fps: 25,
      hasVideo: true,
      hasAudio: true,
    });
  });

  it("imagem não tem duração nem fps", () => {
    const m = mediaRefFromProbe(probe({ kind: "image", durationUs: null, fps: 25, hasAudio: false }), "a.png", "i");
    expect(m.durationUs).toBeNull();
    expect(m.fps).toBeNull();
  });

  it("áudio não tem fps", () => {
    const m = mediaRefFromProbe(
      probe({ kind: "audio", width: null, height: null, fps: null, hasVideo: false }),
      "/m/s.wav",
      "a",
    );
    expect(m).toMatchObject({ kind: "audio", name: "s.wav", fps: null, hasVideo: false });
  });
});

describe("caminhos", () => {
  it("fileName e pathKey", () => {
    expect(fileName("C:/a/b/c.mov")).toBe("c.mov");
    expect(pathKey("C:/Videos/A.MP4")).toBe(pathKey("c:\\videos\\a.mp4"));
  });

  it("encontra mídia já importada ignorando caixa e barras", () => {
    const p = createEmptyProject();
    p.media.push(mediaRefFromProbe(probe(), "C:\\Videos\\A.mp4", "m1"));
    expect(findMediaByPath(p, "c:/videos/a.MP4")?.id).toBe("m1");
    expect(findMediaByPath(p, "c:/videos/b.mp4")).toBeUndefined();
  });
});

describe("thumbnailTimeUs", () => {
  const ref = (over: Partial<MediaRef>) => ({ ...mediaRefFromProbe(probe(), "x.mp4", "m"), ...over });

  it("usa 1 s em vídeos longos e 10% em curtos", () => {
    expect(thumbnailTimeUs(ref({ durationUs: 60_000_000 }))).toBe(1_000_000);
    expect(thumbnailTimeUs(ref({ durationUs: 3_000_000 }))).toBe(300_000);
  });

  it("imagem usa 0 e áudio não tem miniatura", () => {
    expect(thumbnailTimeUs(ref({ kind: "image", durationUs: null }))).toBe(0);
    expect(thumbnailTimeUs(ref({ kind: "audio" }))).toBeNull();
  });
});

describe("isMediaInUse", () => {
  it("detecta mídia usada por algum clipe", () => {
    const p = createEmptyProject();
    p.media.push(mediaRefFromProbe(probe(), "x.mp4", "m1"));
    expect(isMediaInUse(p, "m1")).toBe(false);
    p.tracks[1].clips.push({
      id: "c1",
      mediaId: "m1",
      timelineStartUs: 0,
      sourceInUs: 0,
      sourceOutUs: 1_000_000,
      speed: 1,
      volume: 1,
      brightness: 1,
      contrast: 1,
    });
    expect(isMediaInUse(p, "m1")).toBe(true);
  });
});
