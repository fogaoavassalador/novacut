/**
 * Grafo de áudio da pré-visualização (Web Audio):
 *   <video>/<audio> → ganho do clipe (0–400%) → master → analisador → saída.
 *
 * O elemento precisa de `crossOrigin="anonymous"`: sem isso o WebView trata a
 * mídia do protocolo `asset` como de outra origem e entrega silêncio ao grafo.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
const clipGains = new WeakMap<HTMLMediaElement, GainNode>();

function graph(): { ctx: AudioContext; master: GainNode; analyser: AnalyserNode } {
  if (!ctx || !master || !analyser) {
    ctx = new AudioContext();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(ctx.destination);
  }
  return { ctx, master, analyser };
}

/** Liga o elemento ao grafo (uma única vez) e devolve o nó de ganho do clipe. */
export function clipGain(el: HTMLMediaElement): GainNode {
  let gain = clipGains.get(el);
  if (!gain) {
    const g = graph();
    gain = g.ctx.createGain();
    g.ctx.createMediaElementSource(el).connect(gain);
    gain.connect(g.master);
    clipGains.set(el, gain);
  }
  return gain;
}

/** Retoma o contexto (o navegador o suspende até haver interação do usuário). */
export function resumeAudio(): void {
  if (ctx && ctx.state !== "running") void ctx.resume();
}

/** Nível RMS atual da saída (0 = silêncio). Usado pelos testes E2E. */
export function outputLevel(): number {
  if (!analyser) return 0;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

if (import.meta.env.DEV) {
  (window as unknown as { __novacutOutputLevel: typeof outputLevel }).__novacutOutputLevel = outputLevel;
}
