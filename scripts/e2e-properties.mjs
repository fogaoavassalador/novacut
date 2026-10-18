// Teste ponta a ponta do painel de propriedades (ver README, "Testes E2E").
// Atenção: toca cerca de 2 s de áudio (mede o volume real na saída).
import { connect, CTRL, S, sleep } from "./cdp.mjs";

const { evaluate, click, drag, key, typeInto, reloadDemo, check, finish } = await connect();
await reloadDemo();

const clipRect = (name) =>
  evaluate(`(() => { const e = [...document.querySelectorAll('.clip')].find(c => c.dataset.clipName === ${JSON.stringify(name)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2, start: +e.dataset.startUs, end: +e.dataset.endUs, id: e.dataset.clipId }; })()`);
const select = async (name, modifiers = 0) => {
  const r = await clipRect(name);
  await click(r.x, r.y, { modifiers });
};
const row = (prop) =>
  evaluate(`(() => { const r = document.querySelector('.props-row[data-prop="${prop}"]');
    return r && { disabled: r.classList.contains('disabled'), value: r.querySelector('.props-input').value }; })()`);
const title = () => evaluate(`document.querySelector('.props-title')?.textContent ?? null`);
const field = (prop) => `.props-row[data-prop="${prop}"] .props-input`;

// 1. Painel reflete a seleção e desabilita o que não se aplica
await select("tom 220Hz.wav");
check("painel mostra o clipe selecionado", (await title()) === "tom 220Hz.wav");
check("brilho desabilitado para áudio", (await row("brightness")).disabled && (await row("contrast")).disabled);
check("volume e velocidade habilitados para áudio", !(await row("volume")).disabled && !(await row("speed")).disabled);
await select("padrão.png");
check("velocidade e volume desabilitados para imagem", (await row("speed")).disabled && (await row("volume")).disabled);

// 2. Velocidade muda a duração; desfazer volta
await select("vertical 720x1280.mp4");
await typeInto(field("speed"), "2");
let v = await clipRect("vertical 720x1280.mp4");
check("velocidade 2× reduz a duração de 4 s para 2 s", v.end - v.start === 2 * S, `${(v.end - v.start) / S} s`);
await key("z", CTRL);
v = await clipRect("vertical 720x1280.mp4");
check("Ctrl+Z restaura a velocidade", v.end - v.start === 4 * S && (await row("speed")).value === "1");

// 3. Desacelerar invadindo o vizinho é recusado com mensagem
await select("barras 1080p.mp4");
await typeInto(field("speed"), "0,5");
const err = await evaluate(`document.querySelector('.edit-error')?.textContent ?? null`);
const b = await clipRect("barras 1080p.mp4");
check("desacelerar sobre o vizinho é recusado", b.end === 8 * S && /não há espaço/.test(err ?? ""), err ?? "sem mensagem");

// 4. Brilho por controle deslizante: arraste inteiro = 1 passo de desfazer, aplicado na pré-visualização
const slider = await evaluate(`(() => { const r = document.querySelector('.props-row[data-prop="brightness"] .props-slider').getBoundingClientRect();
  return { x0: r.x + r.width / 2, x1: r.x + r.width * 0.75, y: r.y + r.height / 2 }; })()`);
await drag(slider.x0, slider.y, slider.x1, slider.y);
const bright = Number((await row("brightness")).value);
const filter = await evaluate(`(() => { const id = ${JSON.stringify(b.id)}; const e = document.querySelector('.preview-frame video[data-clip-id="' + id + '"]'); return e && getComputedStyle(e).filter; })()`);
check("arrastar o brilho para a direita aumenta o valor", bright > 120, `${bright}%`);
check(
  "o valor do painel é o aplicado na pré-visualização",
  (filter ?? "").includes(`brightness(${bright / 100})`),
  filter ?? "sem elemento",
);
// Com o foco ainda no controle deslizante, Ctrl+Z deve desfazer o projeto.
const focused = await evaluate(`document.activeElement?.type ?? null`);
await key("z", CTRL);
check("um único Ctrl+Z desfaz o arraste inteiro", (await row("brightness")).value === "100", `foco em: ${focused}`);

// 5. Seleção múltipla
await select("barras 1080p.mp4");
await select("vertical 720x1280.mp4", CTRL);
check("seleção múltipla", (await title()) === "2 clipes selecionados");

// 6. Volume acima de 100% é audível: mede o nível real da saída (Web Audio)
await select("barras 1080p.mp4");
await typeInto(field("volume"), "0"); // isola o tom
await select("tom 220Hz.wav");
const ruler = await evaluate(`(() => { const r = document.querySelector('.ruler').getBoundingClientRect(); const s = document.querySelector('.timeline-scroller');
  return { x: r.x - s.scrollLeft, y: r.y + r.height / 2, pps: parseFloat(document.querySelector('.toolbar-zoom').textContent) }; })()`);
async function levelAt(volumePct) {
  await select("tom 220Hz.wav");
  await typeInto(field("volume"), String(volumePct));
  await click(ruler.x + 3 * ruler.pps, ruler.y);
  await key("Space");
  await sleep(350);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await evaluate("window.__novacutOutputLevel()"));
    await sleep(50);
  }
  await key("Space");
  samples.sort((a, c) => a - c);
  return samples[4];
}
const l100 = await levelAt(100);
const l200 = await levelAt(200);
check("áudio passa pelo Web Audio (não é silêncio)", l100 > 0.01, `RMS ${l100.toFixed(4)}`);
check("200% dobra o nível de saída", Math.abs(l200 / l100 - 2) < 0.25, `razão ${(l200 / l100).toFixed(2)}`);

finish();
