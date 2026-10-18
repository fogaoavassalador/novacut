// Teste ponta a ponta da exportação (ver README, "Testes E2E").
// Exporta o fixture para uma pasta temporária, confere o MP4 com ffprobe e
// testa o cancelamento no meio de uma exportação.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, sleep } from "./cdp.mjs";

const { evaluate, typeInto, reloadDemo, check, finish } = await connect();
await reloadDemo();

const outDir = join(tmpdir(), "novacut-e2e-export");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const clickSel = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const selectValue = (sel, value) =>
  evaluate(`(() => { const s = document.querySelector(${JSON.stringify(sel)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
    s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
async function waitFor(fn, label, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  console.log(`  (tempo esgotado: ${label})`);
  return null;
}
const encoderOptions = () =>
  evaluate(`[...document.querySelectorAll('.export-encoder option')].map(o => o.value).filter(v => v.startsWith('h264') || v.startsWith('lib'))`);

// 1. Abrir o diálogo; encoders detectados
await clickSel(".export-open");
const encoders = await waitFor(async () => {
  const opts = await encoderOptions();
  return opts.length ? opts : null;
}, "detecção de encoders", 30000);
check("diálogo abre e lista encoders que funcionam", !!encoders?.length, (encoders ?? []).join(", "));
check("NVENC não é oferecido sem GPU NVIDIA", !(encoders ?? []).includes("h264_nvenc"));

// 2. Exportar em 1280×720 com o encoder padrão
const out1 = join(outDir, "Teste E2E 720p.mp4");
await selectValue(".export-resolution", "1");
await typeInto(".export-path", out1);
await clickSel(".export-start");
let maxPct = 0;
const done = await waitFor(async () => {
  const pct = await evaluate(`Number(document.querySelector('.export-percent')?.textContent?.replace('%','') ?? -1)`);
  if (pct > maxPct) maxPct = pct;
  return evaluate(`!!document.querySelector('.export-result.ok')`);
}, "fim da exportação", 180000);
check("exportação conclui", !!done, `progresso máximo visto: ${maxPct}%`);

const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out1]).toString());
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
check("MP4 com H.264 1280×720 a 30 fps", v?.codec_name === "h264" && v.width === 1280 && v.height === 720 && v.avg_frame_rate === "30/1", `${v?.codec_name} ${v?.width}×${v?.height} ${v?.avg_frame_rate}`);
check("áudio AAC", a?.codec_name === "aac");
check("duração igual à do projeto (12 s)", Math.abs(Number(probe.format.duration) - 12) < 0.1, `${probe.format.duration} s`);
check("nenhum arquivo temporário sobrou", readdirSync(outDir).every((f) => !f.includes("novacut-part")), readdirSync(outDir).join(", "));

// 3. Cancelar no meio: 1080p com encoder de software (mais lento)
await evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Fechar').click()`);
await clickSel(".export-open");
await waitFor(async () => (await encoderOptions()).length > 0, "encoders", 30000);
const out2 = join(outDir, "cancelado.mp4");
await selectValue(".export-encoder", "libopenh264");
await selectValue(".export-resolution", "0");
await typeInto(".export-path", out2);
await clickSel(".export-start");
await waitFor(() => evaluate(`!!document.querySelector('.export-cancel')`), "barra de progresso", 10000);
await clickSel(".export-cancel");
const cancelled = await waitFor(
  () => evaluate(`document.querySelector('.export-result')?.textContent ?? ''`).then((t) => (t.includes("cancelada") ? t : null)),
  "cancelamento",
  30000,
);
check("cancelar interrompe a exportação", !!cancelled, cancelled ?? "");
await sleep(300);
check("cancelamento não deixa arquivo final nem temporário", !existsSync(out2) && readdirSync(outDir).every((f) => !f.includes("novacut-part")), readdirSync(outDir).join(", "));

await evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Fechar').click()`);
rmSync(outDir, { recursive: true, force: true });
finish();
