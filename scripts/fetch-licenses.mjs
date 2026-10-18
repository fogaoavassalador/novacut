// Baixa os textos de licença listados em third_party_licenses/sources.json (os que não vêm
// nos pacotes: bibliotecas externas do FFmpeg e alguns crates Rust) para third_party_licenses/.
//   ffmpeg/<id>/<arquivo>               — cada biblioteca, no commit usado pelo build BtbN
//   rust/<crate>-<versão>/<arquivo>     — crates publicados sem arquivo de licença
// Grava o SHA-256 de cada arquivo em sources.json; nas próximas execuções, arquivo presente
// com o hash certo não é baixado de novo, e hash diferente é erro.
// Os textos ficam versionados: só é preciso rodar ao trocar o FFmpeg ou os crates.
// Uso: npm run fetch-licenses

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const base = resolve("third_party_licenses");
const sourcesPath = join(base, "sources.json");
const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function download(url) {
  const res = await fetch(url, { headers: { "user-agent": "novacut-fetch-licenses" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // o gitiles (googlesource.com) entrega ?format=TEXT em base64
  return /googlesource\.com\/.*\?format=TEXT$/.test(url) ? Buffer.from(buf.toString("ascii"), "base64") : buf;
}

/** Arquivo copiado do cache local do cargo (ex.: "cssparser-0.37.0/LICENSE"). */
function fromCargo(rel) {
  const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  for (const index of existsSync(registry) ? readdirSync(registry) : []) {
    const p = join(registry, index, rel);
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`${rel} não encontrado em ${registry}`);
}

let fetched = 0;
let kept = 0;
async function ensure(dir, file) {
  const dest = join(dir, file.name);
  if (existsSync(dest) && file.sha256) {
    const actual = sha256(readFileSync(dest));
    if (actual !== file.sha256) throw new Error(`${dest}: SHA-256 ${actual}, esperado ${file.sha256}`);
    kept++;
    return;
  }
  const buf = file.cargo ? fromCargo(file.cargo) : await download(file.url);
  const actual = sha256(buf);
  if (file.sha256 && actual !== file.sha256) throw new Error(`${file.url ?? file.cargo}: SHA-256 ${actual}, esperado ${file.sha256}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(dest, buf);
  file.sha256 = actual;
  fetched++;
  console.log(`${dest.slice(base.length + 1)} (${buf.length} bytes)`);
}

try {
  for (const lib of sources.ffmpeg.libraries) {
    for (const file of lib.files) await ensure(join(base, "ffmpeg", lib.id), file);
  }
  for (const entry of sources.rust) {
    for (const crate of entry.crates) {
      for (const file of entry.files) await ensure(join(base, "rust", crate.replace(" ", "-")), file);
    }
  }
} finally {
  // mesmo se um download falhar, guarda os hashes dos que já vieram
  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
}
console.log(`licenças: ${fetched} obtidas, ${kept} já presentes → ${base}`);
