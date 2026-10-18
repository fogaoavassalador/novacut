// Teste ponta a ponta da pré-visualização no app real (ver README, "Testes E2E").
import { connect, S, sleep } from "./cdp.mjs";

const { evaluate, click, doubleClick, key, reloadDemo, check, finish } = await connect();
await reloadDemo();

/** Estado dos elementos de mídia da pré-visualização, por nome da mídia do clipe. */
const media = () =>
  evaluate(`(() => {
    const names = Object.fromEntries([...document.querySelectorAll('.clip')].map(c => [c.dataset.clipId, c.dataset.clipName]));
    return [...document.querySelectorAll('.preview-frame video, .preview-frame audio')].map(e => ({
      name: names[e.dataset.clipId], tag: e.tagName, src: e.currentSrc, t: e.currentTime, paused: e.paused,
      ready: e.readyState, w: e.videoWidth ?? 0, visible: getComputedStyle(e).visibility === 'visible',
      z: +getComputedStyle(e).zIndex || 0, error: e.error && e.error.code }));
  })()`);
const find = async (name) => (await media()).find((m) => m.name === name);
const playheadS = async () => {
  const [h, m, s, f] = (await evaluate(`document.querySelector('.toolbar-timecode').textContent`)).split(":").map(Number);
  return h * 3600 + m * 60 + s + f / 30;
};
async function waitFor(fn, label, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(100);
  }
  console.log(`  (tempo esgotado esperando: ${label})`);
  return false;
}
async function rulerClickAt(seconds) {
  const r = await evaluate(`(() => { const s = document.querySelector('.timeline-scroller'); const r = document.querySelector('.ruler').getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, scroll: s.scrollLeft, pps: parseFloat(document.querySelector('.toolbar-zoom').textContent) }; })()`);
  await click(r.x + seconds * r.pps - r.scroll, r.y);
}

// 1. Vídeos carregam pelo protocolo asset (escopo dinâmico)
await waitFor(async () => (await find("barras 1080p.mp4"))?.ready >= 2, "vídeo pronto");
const barras = await find("barras 1080p.mp4");
check("vídeo decodifica via protocolo asset", barras?.ready >= 2 && barras.w === 1920 && barras.src.includes("asset.localhost"), `readyState=${barras?.ready}, ${barras?.w}px`);
check("em 0 s só V1 está visível", barras.visible && !(await find("vertical 720x1280.mp4"))?.visible);

// 2. Mover o playhead posiciona cada mídia no instante certo
await rulerClickAt(3);
await sleep(400);
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const b3 = await find("barras 1080p.mp4");
const v3 = await find("vertical 720x1280.mp4");
const t3 = await find("tom 220Hz.wav");
check("playhead em 3 s", near(await playheadS(), 3, 0.001));
check("V1 posicionado em 3,0 s da mídia", near(b3.t, 3), `${b3.t.toFixed(3)} s`);
check("V2 posicionado em 1,5 s da mídia (entra em 2 s, corte 0,5 s)", near(v3.t, 1.5), `${v3.t.toFixed(3)} s`);
check("áudio posicionado em 2,0 s da mídia (entra em 1 s)", near(t3.t, 2), `${t3.t.toFixed(3)} s`);
check("V2 fica por cima de V1", v3.visible && v3.z > b3.z, `z ${v3.z} > ${b3.z}`);

// 3. Reproduzir e pausar com a barra de espaço
const before = await playheadS();
await key("Space");
await sleep(1500);
const playingMedia = await find("barras 1080p.mp4");
const ph = await playheadS();
check("Espaço inicia a reprodução e o playhead avança", ph - before > 1.2 && ph - before < 1.9, `${(ph - before).toFixed(2)} s em 1,5 s`);
check("vídeo toca em sincronia com o playhead", !playingMedia.paused && near(playingMedia.t, ph, 0.2), `vídeo ${playingMedia.t.toFixed(2)} s × playhead ${ph.toFixed(2)} s`);
await key("Space");
await sleep(300);
const all = await media();
check("Espaço pausa todos os elementos", all.every((m) => m.paused));

// 4. A reprodução para no fim do projeto
await key("End");
const end = await playheadS();
await rulerClickAt(end - 0.5);
await key("Space");
await sleep(1200);
const stopped = await evaluate(`document.querySelector('.play-button').getAttribute('aria-label')`);
check("para sozinha no fim", stopped === "Reproduzir" && near(await playheadS(), end, 0.04), `playhead ${(await playheadS()).toFixed(2)} s, fim ${end.toFixed(2)} s`);

// 5. GIF entra na timeline e ganha proxy H.264 automaticamente
const card = await evaluate(`(() => { const c = [...document.querySelectorAll('.media-card')].find(e => e.querySelector('.media-name').textContent === 'animação.gif');
  const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 30 }; })()`);
await doubleClick(card.x, card.y);
await evaluate(`[...document.querySelectorAll('.timeline-toolbar button')].find(b => b.textContent.includes('Ajustar')).click()`);
await sleep(200);
const gifClip = await evaluate(`(() => { const c = [...document.querySelectorAll('.clip')].find(e => e.dataset.clipName === 'animação.gif'); return c && { start: +c.dataset.startUs, end: +c.dataset.endUs }; })()`);
check("duplo clique adiciona o GIF à timeline", !!gifClip, gifClip ? `${gifClip.start / S}–${gifClip.end / S} s` : "");
await rulerClickAt(gifClip.start / S + 1);
const proxied = await waitFor(async () => {
  const g = await find("animação.gif");
  return g?.src.includes("proxies") && g.ready >= 2;
}, "proxy do GIF", 60000);
const g = await find("animação.gif");
check("GIF não suportado ganha proxy H.264 e decodifica", proxied && g.w === 320, g ? `${g.src.split("/").pop()} · ${g.w}px` : "sem elemento");

finish();
