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
import { inflateRawSync } from "node:zlib";

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

/**
 * Licença que só existe nos comentários de cabeçalhos C: baixa o início de cada arquivo (Range),
 * extrai o primeiro bloco /* … *\/ e junta os blocos distintos, indicando a quais arquivos valem.
 */
async function fromHeaders(urls) {
  const blocks = new Map();
  for (const url of urls) {
    const res = await fetch(url, { headers: { "user-agent": "novacut-fetch-licenses", range: "bytes=0-4095" } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const comment = /\/\*([\s\S]*?)\*\//.exec(await res.text())?.[1];
    if (!comment) throw new Error(`sem comentário de licença no início de ${url}`);
    const text = comment.split("\n").map((l) => l.replace(/^\s*\* ?/, "").trimEnd()).join("\n").trim();
    const name = url.split("/").pop();
    blocks.set(text, [...(blocks.get(text) ?? []), name]);
  }
  return Buffer.from(
    [...blocks].map(([text, names]) => `Arquivos: ${names.join(", ")}\n\n${text}\n`).join("\n"),
  );
}

async function range(url, start, end) {
  const res = await fetch(url, { headers: { "user-agent": "novacut-fetch-licenses", range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`${res.status} (esperado 206) ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Um arquivo de dentro de um .zip remoto (ex.: a licença num .nupkg) sem baixar o pacote inteiro:
 * lê o diretório central no fim do arquivo e depois só os bytes da entrada pedida.
 */
async function fromZip({ url, size, path }) {
  const tail = await range(url, Math.max(0, size - 65536), size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`fim do zip não encontrado em ${url}`);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  for (let p = 0; p < cd.length; ) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const local = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === path) {
      const head = await range(url, local, local + 29);
      const dataStart = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const data = await range(url, dataStart, dataStart + compSize - 1);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`método de compressão ${method} não suportado (${path})`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${path} não está em ${url}`);
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
  if (file.generated) throw new Error(`${dest} ausente: gere com ${file.generated}`);
  const buf = file.cargo ? fromCargo(file.cargo) : file.zip ? await fromZip(file.zip) : file.headers ? await fromHeaders(file.headers) : await download(file.url);
  const actual = sha256(buf);
  if (file.sha256 && actual !== file.sha256) throw new Error(`${file.url ?? file.cargo ?? file.name}: SHA-256 ${actual}, esperado ${file.sha256}`);
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
