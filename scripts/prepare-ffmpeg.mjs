// Copia o FFmpeg que vai embutido no instalador para src-tauri/ffmpeg/.
//
// Origem: NOVACUT_FFMPEG_SOURCE (pasta com ffmpeg.exe) ou o ffmpeg do PATH.
// - Recusa builds GPL ou "nonfree" (o NovaCut distribui só LGPL), salvo com
//   NOVACUT_ALLOW_GPL=1, e nesse caso as obrigações da GPL são suas.
// - Copia ffmpeg.exe, ffprobe.exe e as DLLs (build "shared": o usuário pode
//   trocar as bibliotecas, como a LGPL prevê). Não copia o ffplay.
// - Grava ffmpeg-manifest.json com versão, configuração e SHA-256 de cada arquivo.
// - Copia a licença do build para src-tauri/licenses/.
// Uso: npm run prepare-ffmpeg

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dest = resolve("src-tauri", "ffmpeg");
const licensesDir = resolve("src-tauri", "licenses");

function sourceDir() {
  if (process.env.NOVACUT_FFMPEG_SOURCE) return resolve(process.env.NOVACUT_FFMPEG_SOURCE);
  const found = execFileSync("where", ["ffmpeg"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  if (!found) throw new Error("ffmpeg não encontrado: defina NOVACUT_FFMPEG_SOURCE");
  return dirname(found.trim());
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const src = sourceDir();
const exe = join(src, "ffmpeg.exe");
if (!existsSync(exe) || !existsSync(join(src, "ffprobe.exe"))) throw new Error(`ffmpeg.exe/ffprobe.exe ausentes em ${src}`);

const versionOut = execFileSync(exe, ["-hide_banner", "-version"], { encoding: "utf8" });
const version = /^ffmpeg version (\S+)/m.exec(versionOut)?.[1] ?? "desconhecida";
const configuration = /^configuration: (.*)$/m.exec(versionOut)?.[1] ?? "";
const flags = new Set(configuration.split(/\s+/));
const license = flags.has("--enable-gpl") ? "GPL" : flags.has("--enable-version3") ? "LGPLv3" : "LGPLv2.1";
if ((flags.has("--enable-gpl") || flags.has("--enable-nonfree")) && process.env.NOVACUT_ALLOW_GPL !== "1") {
  throw new Error(`o build em ${src} é ${flags.has("--enable-nonfree") ? "nonfree" : "GPL"}; use um build LGPL`);
}
// O chromaprint do BtbN vem ligado ao FFTW3 (GPLv2+). O build próprio (.github/workflows/build-ffmpeg.yml) não o tem.
if (flags.has("--enable-chromaprint")) {
  const msg = `o build em ${src} tem --enable-chromaprint (no BtbN, ligado ao FFTW3, que é GPL); use o build de .github/workflows/build-ffmpeg.yml`;
  if (process.env.NOVACUT_STRICT_LICENSES === "1") throw new Error(msg);
  console.warn(`aviso: ${msg}`);
}

const files = readdirSync(src).filter((f) => /^(ffmpeg|ffprobe)\.exe$|\.dll$/i.test(f)).sort();
const manifest = {
  version,
  license,
  configuration,
  sourceDir: src,
  files: files.map((name) => ({ name, bytes: statSync(join(src, name)).size, sha256: sha256(join(src, name)) })),
};

// Nada mudou? Não recopia ~140 MB.
const manifestPath = join(dest, "ffmpeg-manifest.json");
if (existsSync(manifestPath)) {
  const old = JSON.parse(readFileSync(manifestPath, "utf8"));
  const same =
    JSON.stringify(old.files) === JSON.stringify(manifest.files) &&
    manifest.files.every((f) => existsSync(join(dest, f.name)) && statSync(join(dest, f.name)).size === f.bytes);
  if (same) {
    console.log(`FFmpeg ${version} (${license}) já preparado em ${dest}`);
    process.exit(0);
  }
}

// Limpa cópias antigas (preserva .gitkeep) e copia.
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(dest)) if (f !== ".gitkeep") rmSync(join(dest, f), { force: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
for (const f of manifest.files) {
  if (sha256(join(dest, f.name)) !== f.sha256) throw new Error(`cópia corrompida: ${f.name}`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// Licença do build (LGPLv3 no build BtbN; fica na pasta acima de bin/).
mkdirSync(licensesDir, { recursive: true });
const buildLicense = join(dirname(src), "LICENSE.txt");
if (existsSync(buildLicense)) copyFileSync(buildLicense, join(licensesDir, "FFmpeg-LICENSE.txt"));
else console.warn("aviso: LICENSE.txt do build não encontrado; inclua a licença do FFmpeg manualmente");

const total = manifest.files.reduce((s, f) => s + f.bytes, 0);
console.log(`FFmpeg ${version} (${license}) copiado: ${files.length} arquivos, ${(total / 1048576).toFixed(1)} MB → ${dest}`);
