// Gera os avisos de licença distribuídos com o instalador, em src-tauri/licenses/:
//   THIRD_PARTY_NOTICES.txt — dependências JavaScript (produção) e crates Rust
//                             (dependências normais, Windows), com os textos de licença
//   FFMPEG-NOTICE.txt       — versão, configuração e onde obter o código-fonte do FFmpeg
//   FFMPEG-THIRD-PARTY.txt  — licenças das bibliotecas externas compiladas no FFmpeg
//   GPL-3.0.txt             — exigido pela LGPLv3 (que incorpora a GPLv3)
// Requer `npm run prepare-ffmpeg` antes (lê src-tauri/ffmpeg/ffmpeg-manifest.json).
// Textos que não vêm nos pacotes ficam em third_party_licenses/ (npm run fetch-licenses).
// Uso: npm run notices

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const outDir = resolve("src-tauri", "licenses");
mkdirSync(outDir, { recursive: true });
const warnings = [];

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;
function licenseTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => `--- ${f} ---\n${readFileSync(join(dir, f), "utf8").trim()}`);
}

// ---------- textos versionados em third_party_licenses/ (npm run fetch-licenses) ----------
const tplDir = resolve("third_party_licenses");
const tplSources = JSON.parse(readFileSync(join(tplDir, "sources.json"), "utf8"));
const tplHashes = new Map();
for (const lib of tplSources.ffmpeg.libraries) for (const f of lib.files) tplHashes.set(join("ffmpeg", lib.id, f.name), f.sha256);
for (const e of tplSources.rust) for (const c of e.crates) for (const f of e.files) tplHashes.set(join("rust", c.replace(" ", "-"), f.name), f.sha256);
/** Textos de third_party_licenses/<rel>/, conferidos com o SHA-256 de sources.json. */
function thirdPartyTexts(rel, label) {
  const dir = join(tplDir, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((f) => {
      const buf = readFileSync(join(dir, f));
      const expected = tplHashes.get(join(rel, f));
      if (createHash("sha256").update(buf).digest("hex") !== expected) {
        warnings.push(`${label}: third_party_licenses/${rel}/${f} não confere com sources.json (rode npm run fetch-licenses)`);
      }
      return `--- ${f} ---\n${buf.toString("utf8").trim()}`;
    });
}

const rule = "=".repeat(78);
/** BOM: o Bloco de Notas e outros editores reconhecem o UTF-8 sem adivinhar. */
const BOM = "\ufeff";
const sections = [];

// ---------- JavaScript (vai no bundle do frontend) ----------
// Via `npm run`, chama o npm pelo próprio Node (sem shell); fora disso, usa o npm.cmd pelo shell.
const npmArgs = ["ls", "--omit=dev", "--all", "--json"];
const tree = JSON.parse(
  process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], { cwd: root, encoding: "utf8" })
    : execFileSync(`npm ${npmArgs.join(" ")}`, { cwd: root, encoding: "utf8", shell: true }),
);
const js = new Map();
(function walk(deps = {}) {
  for (const [name, info] of Object.entries(deps)) {
    const key = `${name}@${info.version}`;
    if (js.has(key)) continue;
    js.set(key, name);
    walk(info.dependencies);
  }
})(tree.dependencies);
for (const [key, name] of [...js].sort()) {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const texts = licenseTexts(dir);
  if (!texts.length) warnings.push(`JS ${key}: sem arquivo de licença no pacote (licença declarada: ${pkg.license})`);
  sections.push(`${rule}\n${key} (JavaScript) — ${pkg.license ?? "licença não declarada"}\n${pkg.repository?.url ?? pkg.homepage ?? ""}\n\n${texts.join("\n\n")}`);
}

// ---------- Rust (crates compilados no executável do Windows) ----------
const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc"], {
    cwd: resolve("src-tauri"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }),
);
const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const rootId = meta.resolve.root;
const rust = new Set();
(function walk(id) {
  for (const dep of nodes.get(id)?.deps ?? []) {
    // só dependências normais (as de build e de teste não vão no executável)
    if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
    if (rust.has(dep.pkg)) continue;
    rust.add(dep.pkg);
    walk(dep.pkg);
  }
})(rootId);
for (const id of [...rust].sort((a, b) => pkgs.get(a).name.localeCompare(pkgs.get(b).name))) {
  const p = pkgs.get(id);
  let texts = licenseTexts(dirname(p.manifest_path));
  // crates publicados sem o arquivo: texto obtido do repositório por npm run fetch-licenses
  if (!texts.length) texts = thirdPartyTexts(join("rust", `${p.name}-${p.version}`), `Rust ${p.name} ${p.version}`);
  if (!texts.length) warnings.push(`Rust ${p.name} ${p.version}: sem arquivo de licença no crate (licença declarada: ${p.license})`);
  sections.push(`${rule}\n${p.name} ${p.version} (Rust) — ${p.license ?? p.license_file ?? "licença não declarada"}\n${p.repository ?? ""}\n\n${texts.join("\n\n")}`);
}

const header = `NovaCut — avisos de licença de terceiros
Gerado automaticamente por scripts/gen-notices.mjs em ${new Date().toISOString()}.

O FFmpeg distribuído com o NovaCut tem aviso próprio em FFMPEG-NOTICE.txt.
Dependências JavaScript: ${js.size} · crates Rust: ${rust.size}
`;
writeFileSync(join(outDir, "THIRD_PARTY_NOTICES.txt"), `${BOM}${header}\n${sections.join("\n\n")}\n`);

// ---------- FFmpeg ----------
const manifestPath = resolve("src-tauri", "ffmpeg", "ffmpeg-manifest.json");
if (!existsSync(manifestPath)) throw new Error("rode `npm run prepare-ffmpeg` antes");
const ff = JSON.parse(readFileSync(manifestPath, "utf8"));
const commit = /-g([0-9a-f]{7,40})/.exec(ff.version)?.[1];
const enabled = ff.configuration
  .split(/\s+/)
  .filter((f) => f.startsWith("--enable-"))
  .map((f) => f.slice("--enable-".length));
const libs = enabled.filter((f) => f.startsWith("lib")).map((f) => f.slice("lib".length));
// opções sem o prefixo "lib" que também ligam código de terceiros ao FFmpeg
const EXTERNAL = new Set(["iconv", "zlib", "fontconfig", "gmp", "lzma", "opencl", "vulkan", "amf", "chromaprint", "ffnvcodec", "lv2", "openal", "sdl2", "vaapi"]);
const ffLibs = tplSources.ffmpeg.libraries;
if (!tplSources.ffmpeg.build.startsWith(ff.version)) {
  warnings.push(`FFmpeg: third_party_licenses/sources.json é do build ${tplSources.ffmpeg.build}, mas o embutido é ${ff.version}; atualize as versões pelos scripts do BtbN`);
}
const covered = new Set(ffLibs.flatMap((l) => l.enables ?? []));
const uncovered = enabled.filter((f) => (f.startsWith("lib") || EXTERNAL.has(f)) && !covered.has(f));
if (uncovered.length) warnings.push(`FFmpeg: sem texto de licença em third_party_licenses/sources.json para --enable-${uncovered.join(", --enable-")}`);
for (const l of ffLibs) if (l.pending) warnings.push(`FFmpeg/${l.id}: ${l.pending}`);
const kindOrder = ["lib", "dependência", "embutida"];
const ffSections = [...ffLibs]
  .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.id.localeCompare(b.id))
  .map((l) => {
    const texts = thirdPartyTexts(join("ffmpeg", l.id), `FFmpeg/${l.id}`);
    if (!texts.length && l.files.length) warnings.push(`FFmpeg/${l.id}: textos ausentes em third_party_licenses/ffmpeg/${l.id} (rode npm run fetch-licenses)`);
    const what = l.kind === "lib" ? `--enable-${l.enables.join(", --enable-")}` : `${l.kind}${l.usedBy ? ` de ${l.usedBy}` : ""}`;
    return `${rule}\n${l.id} (${what})\n${l.repo} @ ${l.commit}${l.note ? `\nNota: ${l.note}` : ""}\n\n${texts.join("\n\n")}`;
  });
writeFileSync(
  join(outDir, "FFMPEG-THIRD-PARTY.txt"),
  `${BOM}NovaCut — licenças das bibliotecas de terceiros compiladas no FFmpeg embutido
Gerado automaticamente por scripts/gen-notices.mjs em ${new Date().toISOString()}.

Build: ${tplSources.ffmpeg.build}
Versões: scripts.d do BtbN FFmpeg-Builds, release ${tplSources.ffmpeg.btbnRelease}, commit ${tplSources.ffmpeg.btbnCommit}
Cada texto foi obtido do repositório da biblioteca no commit indicado.

${ffSections.join("\n\n")}
`,
);
const ffNotes = ffLibs.filter((l) => l.note).map((l) => `  ${l.id}: ${l.note}`);
writeFileSync(
  join(outDir, "FFMPEG-NOTICE.txt"),
  `${BOM}O NovaCut usa o FFmpeg (https://ffmpeg.org), executado como programa separado.

Versão: ${ff.version}
Licença do build: ${ff.license} (texto em FFmpeg-LICENSE.txt; a LGPLv3 incorpora a GPLv3, em GPL-3.0.txt)
Build: BtbN FFmpeg-Builds, variante win64-lgpl-shared (https://github.com/BtbN/FFmpeg-Builds)

Código-fonte correspondente:
  FFmpeg: https://github.com/FFmpeg/FFmpeg${commit ? `/tree/${commit}` : ""}
  Scripts de compilação (e versões das bibliotecas externas): https://github.com/BtbN/FFmpeg-Builds

As bibliotecas do FFmpeg (avcodec, avformat, avutil, avfilter, avdevice, swscale,
swresample) são distribuídas como DLLs separadas na pasta "ffmpeg" da instalação e
podem ser substituídas por versões compatíveis.

Configuração da compilação:
${ff.configuration}

Arquivos distribuídos (SHA-256):
${ff.files.map((f) => `  ${f.sha256}  ${f.name}`).join("\n")}

Bibliotecas externas compiladas no FFmpeg (cada uma tem a própria licença):
  ${libs.join(", ")}

Os textos de licença dessas bibliotecas, das dependências delas e do código que elas
embutem estão em FFMPEG-THIRD-PARTY.txt (${ffLibs.length} componentes).
${ffNotes.length ? `\nObservações:\n${ffNotes.join("\n")}\n` : ""}`,
);

// ---------- GPLv3 (exigida pela LGPLv3) ----------
const GPL3_SHA256 = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986"; // COPYING oficial da FSF
const gplCandidates = [process.env.NOVACUT_GPL3_FILE, "C:\\Program Files\\Git\\usr\\share\\licenses\\mintty\\LICENSE.GPL"].filter(Boolean);
const gpl = gplCandidates.find((f) => existsSync(f) && createHash("sha256").update(readFileSync(f)).digest("hex") === GPL3_SHA256);
if (gpl) writeFileSync(join(outDir, "GPL-3.0.txt"), readFileSync(gpl));
else warnings.push("GPL-3.0.txt: cópia oficial não encontrada; defina NOVACUT_GPL3_FILE com o COPYING da GPLv3 (SHA-256 " + GPL3_SHA256 + ")");
if (!existsSync(join(outDir, "FFmpeg-LICENSE.txt"))) warnings.push("FFmpeg-LICENSE.txt ausente (rode npm run prepare-ffmpeg)");

console.log(`avisos gerados em ${outDir}: ${js.size} pacotes JS, ${rust.size} crates Rust`);
for (const w of warnings) console.warn(`PENDENTE: ${w}`);
