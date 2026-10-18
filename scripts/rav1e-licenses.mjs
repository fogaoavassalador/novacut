// Gera third_party_licenses/ffmpeg/rav1e/rav1e-dependencies-licenses.txt: licenças dos crates Rust
// compilados no rav1e (que o FFmpeg embutido liga estaticamente), a partir do Cargo.lock do rav1e.
// Requer o cargo-about (`cargo install cargo-about --locked --features cli`) e o código-fonte do
// rav1e no commit de third_party_licenses/sources.json; o cargo baixa os crates que faltarem.
// Features: as do build BtbN (`cargo cinstall --release` = padrão + capi), o que inclui também
// crates usados só pelo executável do rav1e — sobra, nunca falta.
// Uso: node scripts/rav1e-licenses.mjs <pasta do rav1e>  e depois  npm run fetch-licenses

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const src = process.argv[2];
if (!src) throw new Error("uso: node scripts/rav1e-licenses.mjs <pasta do rav1e>");
const aboutDir = resolve("scripts", "rav1e-about");
const sourcesPath = resolve("third_party_licenses", "sources.json");
const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
const rav1e = sources.ffmpeg.libraries.find((l) => l.id === "rav1e");
const file = rav1e.files.find((f) => f.generated);
const out = resolve("third_party_licenses", "ffmpeg", "rav1e", file.name);

execFileSync(
  "cargo",
  ["about", "generate", "--locked", "--fail", "--features", "capi",
    "-m", join(resolve(src), "Cargo.toml"), "-c", join(aboutDir, "about.toml"), "-o", out, join(aboutDir, "about.hbs")],
  { stdio: "inherit" },
);
// o template marca a origem; o commit vem de sources.json
const text = readFileSync(out, "utf8").replace(/\r\n/g, "\n");
writeFileSync(out, text.replace("\n\nCrates:", `\nrav1e: ${rav1e.repo} @ ${rav1e.commit}\n\nCrates:`));
file.sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
console.log(`${out} (${readFileSync(out).length} bytes)`);
