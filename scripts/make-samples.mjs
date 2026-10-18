// Gera mídias sintéticas para desenvolvimento e testes manuais em ./samples
// (vídeo com áudio, vídeo vertical, áudio, imagem e GIF), além de
// samples/demo.ncproj, que referencia essas mídias e já traz alguns clipes na timeline.
// Uso: npm run samples   (requer ffmpeg e ffprobe no PATH)

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve("samples");
mkdirSync(outDir, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

const files = [
  {
    name: "barras 1080p.mp4",
    args: ["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libopenh264", "-b:v", "6M", "-c:a", "aac", "-shortest"],
  },
  {
    name: "vertical 720x1280.mp4",
    args: ["-f", "lavfi", "-i", "testsrc=size=720x1280:rate=25:duration=5", "-c:v", "libopenh264", "-b:v", "3M"],
  },
  { name: "tom 220Hz.wav", args: ["-f", "lavfi", "-i", "sine=frequency=220:duration=6"] },
  { name: "padrão.png", args: ["-f", "lavfi", "-i", "smptehdbars=size=1280x720", "-frames:v", "1"] },
  { name: "animação.gif", args: ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=2"] },
];

for (const f of files) {
  ff([...f.args, join(outDir, f.name)]);
  console.log("gerado:", f.name);
}

// Monta o projeto de demonstração a partir do ffprobe (mesmos critérios do app).
function probe(path) {
  const json = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).toString(),
  );
  const v = json.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = json.streams.find((s) => s.codec_type === "audio");
  const still = v && !a && (json.format.format_name.endsWith("_pipe") || !json.format.duration);
  const kind = still ? "image" : v ? "video" : "audio";
  const [n, d] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    id: randomUUID(),
    kind,
    path,
    name: path.split(/[\\/]/).pop(),
    durationUs: kind === "image" ? null : Math.round(Number(json.format.duration) * 1e6),
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: kind === "video" && n > 0 && d > 0 ? n / d : null,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

const now = new Date().toISOString();
const track = (kind, name) => ({ id: randomUUID(), kind, name, muted: false, hidden: false, clips: [] });
const media = files.map((f) => probe(join(outDir, f.name)));
const [bars, vertical, tone, still] = media;
const clip = (m, startS, inS, outS) => ({
  id: randomUUID(),
  mediaId: m.id,
  timelineStartUs: Math.round(startS * 1e6),
  sourceInUs: Math.round(inS * 1e6),
  sourceOutUs: Math.round(outS * 1e6),
  speed: 1,
  volume: 1,
  brightness: 1,
  contrast: 1,
});
const [v2, v1, a1] = [track("video", "V2"), track("video", "V1"), track("audio", "A1")];
v1.clips.push(clip(bars, 0, 0, 8), clip(still, 8, 0, 4));
v2.clips.push(clip(vertical, 2, 0.5, 4.5));
a1.clips.push(clip(tone, 1, 0, 6));
const project = {
  format: "novacut-project",
  formatVersion: 1,
  id: randomUUID(),
  name: "Demonstração",
  createdAt: now,
  modifiedAt: now,
  settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000, background: "#000000" },
  media,
  tracks: [v2, v1, a1],
};
writeFileSync(join(outDir, "demo.ncproj"), JSON.stringify(project, null, 2) + "\n");
console.log("projeto:", join(outDir, "demo.ncproj"));
