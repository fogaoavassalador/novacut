// Utilitários compartilhados pelos testes E2E: conexão CDP com a página do
// NovaCut (WebView2 com --remote-debugging-port) e entrada de mouse/teclado.

export const S = 1_000_000;
export const CTRL = 2;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port = process.env.CDP_PORT ?? 9333) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith("http://localhost:1420"));
  if (!page) throw new Error("página do NovaCut não encontrada na porta CDP");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  async function evaluate(expression) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  const mouse = (type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: type === "mouseReleased" ? 0 : 1, ...extra });

  async function click(x, y, { modifiers = 0, clickCount = 1 } = {}) {
    await mouse("mouseMoved", x, y, { buttons: 0, button: "none" });
    await mouse("mousePressed", x, y, { modifiers, clickCount });
    await mouse("mouseReleased", x, y, { modifiers, clickCount });
    await sleep(60);
  }

  async function doubleClick(x, y) {
    await click(x, y, { clickCount: 1 });
    await click(x, y, { clickCount: 2 });
  }

  async function drag(x0, y0, x1, y1, { midCheck } = {}) {
    await mouse("mouseMoved", x0, y0, { buttons: 0, button: "none" });
    await mouse("mousePressed", x0, y0);
    for (let i = 1; i <= 10; i++) {
      await mouse("mouseMoved", x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
      await sleep(10);
    }
    const mid = midCheck ? await midCheck() : undefined;
    await mouse("mouseReleased", x1, y1);
    await sleep(80);
    return mid;
  }

  const VK = { s: 83, z: 90, y: 89, Delete: 46, Space: 32, End: 35, Home: 36, Enter: 13 };
  async function key(k, modifiers = 0) {
    const isChar = k.length === 1;
    const code = isChar ? `Key${k.toUpperCase()}` : k;
    const keyName = k === "Space" ? " " : k;
    const base = { key: keyName, code, windowsVirtualKeyCode: VK[k], modifiers };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    if ((isChar || k === "Space") && !modifiers) await send("Input.dispatchKeyEvent", { type: "char", text: keyName, ...base });
    if (k === "Enter") await send("Input.dispatchKeyEvent", { type: "char", text: "\r", ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(80);
  }

  /** Recarrega a página e espera o projeto de demonstração (4 clipes). */
  async function reloadDemo(minClips = 4) {
    await send("Page.reload", { ignoreCache: true });
    for (let i = 0; i < 100; i++) {
      const n = await evaluate("document.querySelectorAll('.clip').length").catch(() => 0);
      if (n >= minClips) return;
      await sleep(100);
    }
    throw new Error("o projeto de demonstração não carregou");
  }

  let failures = 0;
  function check(label, cond, detail = "") {
    console.log(`${cond ? "ok  " : "FALHA"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failures++;
  }
  function finish() {
    console.log(failures ? `\n${failures} verificação(ões) falharam` : "\nTodas as verificações passaram");
    ws.close();
    process.exit(failures ? 1 : 0);
  }

  /** Foca um campo de texto, substitui o conteúdo e confirma com Enter. */
  async function typeInto(selector, text) {
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`);
    await send("Input.insertText", { text });
    await key("Enter");
  }

  return { send, evaluate, click, doubleClick, drag, key, typeInto, reloadDemo, check, finish };
}
