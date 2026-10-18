/**
 * Tempo no NovaCut é sempre um número inteiro de microssegundos (µs).
 * Nunca guardamos segundos em ponto flutuante no modelo: cortes e divisões
 * repetidos acumulariam erro de arredondamento.
 */
export type Micros = number;

export const US_PER_SECOND = 1_000_000;

export function secondsToMicros(seconds: number): Micros {
  if (!Number.isFinite(seconds)) throw new RangeError(`segundos inválidos: ${seconds}`);
  return Math.round(seconds * US_PER_SECOND);
}

export function microsToSeconds(us: Micros): number {
  return us / US_PER_SECOND;
}

/** Duração de um frame em µs (pode ser fracionária para 29.97 etc.). */
export function frameDurationMicros(fps: number): number {
  assertFps(fps);
  return US_PER_SECOND / fps;
}

/** Índice do frame que contém o instante `us` (arredonda para baixo). */
export function microsToFrame(us: Micros, fps: number): number {
  assertFps(fps);
  // frameToMicros arredonda ao µs, então o início de um frame pode estar até
  // 0,5 µs antes do instante exato; essa meia unidade é tolerada aqui.
  return Math.floor(((us + 0.5) * fps) / US_PER_SECOND);
}

/** Início exato (arredondado ao µs) do frame `frame`. */
export function frameToMicros(frame: number, fps: number): Micros {
  assertFps(fps);
  return Math.round((frame * US_PER_SECOND) / fps);
}

/** Alinha `us` ao início de frame mais próximo. */
export function snapToFrame(us: Micros, fps: number): Micros {
  assertFps(fps);
  return frameToMicros(Math.round((us * fps) / US_PER_SECOND), fps);
}

/**
 * Timecode HH:MM:SS:FF (sem drop-frame). Valores negativos recebem prefixo "-".
 */
export function formatTimecode(us: Micros, fps: number): string {
  assertFps(fps);
  const sign = us < 0 ? "-" : "";
  const totalFrames = microsToFrame(Math.abs(us), fps);
  const nominalFps = Math.round(fps);
  const frames = totalFrames % nominalFps;
  const totalSeconds = Math.floor(totalFrames / nominalFps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${sign}${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(frames)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps inválido: ${fps}`);
}
