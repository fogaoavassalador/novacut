// Teste ponta a ponta da interação da timeline no app real (ver README, "Testes E2E").
import { connect, CTRL, S, sleep } from "./cdp.mjs";

const { send, evaluate, click, drag, key, reloadDemo, check, finish } = await connect();
await reloadDemo();

// ---------- leitura do estado pela DOM ----------
const clips = () =>
  evaluate(`[...document.querySelectorAll('.clip')].map(e => { const r = e.getBoundingClientRect();
    return { name: e.dataset.clipName, start: +e.dataset.startUs, end: +e.dataset.endUs, track: +e.dataset.trackIndex,
             selected: e.classList.contains('selected'), x: r.x, y: r.y, w: r.width, h: r.height }; })`);
const clipNamed = async (name, nth = 0) => (await clips()).filter((c) => c.name === name)[nth];
const pps = async () => parseFloat(await evaluate(`document.querySelector('.toolbar-zoom').textContent`));
const timecode = () => evaluate(`document.querySelector('.toolbar-timecode').textContent`);
const center = (c) => [c.x + c.w / 2, c.y + c.h / 2];

// ---------- cenário ----------
check("projeto de demonstração aberto", (await clips()).length === 4, `${(await clips()).length} clipes`);
const z = await pps();

// 1. Selecionar
let barras = await clipNamed("barras 1080p.mp4");
await click(...center(barras));
let all = await clips();
check("clique seleciona apenas o clipe", all.filter((c) => c.selected).map((c) => c.name).join() === "barras 1080p.mp4");

// 2. Arrastar 'vertical' +2 s na mesma faixa
let vertical = await clipNamed("vertical 720x1280.mp4");
const [vx, vy] = center(vertical);
await drag(vx, vy, vx + 2 * z, vy);
vertical = await clipNamed("vertical 720x1280.mp4");
check("arrastar move o clipe 2 s", vertical.start === 4 * S, `início = ${vertical.start / S} s`);

// 3. Desfazer / refazer o movimento
await key("z", CTRL);
check("Ctrl+Z desfaz o movimento", (await clipNamed("vertical 720x1280.mp4")).start === 2 * S);
await key("y", CTRL);
check("Ctrl+Y refaz o movimento", (await clipNamed("vertical 720x1280.mp4")).start === 4 * S);

// 4. Soltar sobre um clipe ocupado: fantasma vermelho e nada muda
vertical = await clipNamed("vertical 720x1280.mp4");
const [x4, y4] = center(vertical);
const ghostInvalid = await drag(x4, y4, x4, y4 + vertical.h + 10, {
  midCheck: () => evaluate(`!!document.querySelector('.clip-ghost.invalid')`),
});
vertical = await clipNamed("vertical 720x1280.mp4");
check("fantasma fica vermelho sobre espaço ocupado", ghostInvalid === true);
check("soltar em posição inválida não altera nada", vertical.track === 0 && vertical.start === 4 * S);

// 5. Cortar a borda final da imagem 1 s para a esquerda
let png = await clipNamed("padrão.png");
const endX = png.x + png.w - 3;
await drag(endX, png.y + png.h / 2, endX - 1 * z, png.y + png.h / 2);
png = await clipNamed("padrão.png");
check("cortar borda final encurta 1 s", Math.abs(png.end - 11 * S) <= 1, `fim = ${png.end / S} s`);

// 6. Borda inicial do áudio: não passa do início da mídia; avançar 1 s funciona
let tom = await clipNamed("tom 220Hz.wav");
await drag(tom.x + 3, tom.y + tom.h / 2, tom.x + 3 - 3 * z, tom.y + tom.h / 2);
tom = await clipNamed("tom 220Hz.wav");
check("borda inicial limitada pelo início da mídia", tom.start === 1 * S, `início = ${tom.start / S} s`);
await drag(tom.x + 3, tom.y + tom.h / 2, tom.x + 3 + 1 * z, tom.y + tom.h / 2);
tom = await clipNamed("tom 220Hz.wav");
check("cortar borda inicial avança 1 s", tom.start === 2 * S && tom.end === 7 * S, `${tom.start / S}–${tom.end / S} s`);

// 7. Playhead pela régua
const ruler = await evaluate(`(() => { const r = document.querySelector('.ruler').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 }; })()`);
const scroll = await evaluate(`document.querySelector('.timeline-scroller').scrollLeft`);
await click(ruler.x + 3 * z - scroll, ruler.y);
check("clique na régua move o playhead para 3 s", (await timecode()) === "00:00:03:00", await timecode());

// 8. Dividir o clipe selecionado no playhead (tecla S)
barras = await clipNamed("barras 1080p.mp4");
await click(barras.x + 20, barras.y + barras.h / 2);
await key("s");
all = await clips();
const parts = all.filter((c) => c.name === "barras 1080p.mp4").map((c) => `${c.start / S}-${c.end / S}`);
check("S divide só o clipe selecionado no playhead", parts.join() === "0-3,3-8" && all.length === 5, parts.join());

// 9. Desfazer a divisão
await key("z", CTRL);
check("Ctrl+Z junta de novo", (await clips()).filter((c) => c.name === "barras 1080p.mp4").length === 1);

// 10. Excluir e desfazer
tom = await clipNamed("tom 220Hz.wav");
await click(...center(tom));
await key("Delete");
check("Delete exclui o clipe selecionado", !(await clipNamed("tom 220Hz.wav")));
await key("z", CTRL);
check("Ctrl+Z restaura o clipe excluído", !!(await clipNamed("tom 220Hz.wav")));

// 11. Zoom com Ctrl+roda e Ajustar
const sc = await evaluate(`(() => { const r = document.querySelector('.timeline-scroller').getBoundingClientRect(); return { x: r.x + 200, y: r.y + 80 }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: sc.x, y: sc.y, deltaX: 0, deltaY: -300, modifiers: CTRL });
await sleep(100);
const zoomed = await pps();
check("Ctrl+roda aumenta o zoom", zoomed > z, `${z} → ${zoomed} px/s`);
await evaluate(`[...document.querySelectorAll('.timeline-toolbar button')].find(b => b.textContent.includes('Ajustar')).click()`);
await sleep(100);
const fitWidth = await evaluate(`document.querySelector('.timeline-scroller').clientWidth`);
const fitted = await pps();
const projectEndS = Math.max(...(await clips()).map((c) => c.end)) / S;
check(
  "Ajustar faz o projeto caber na largura",
  Math.abs(fitted - (fitWidth * 0.95) / projectEndS) < 1.5,
  `${fitted} px/s para ${projectEndS} s em ${fitWidth}px`,
);

finish();
