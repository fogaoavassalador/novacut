import { type Micros, US_PER_SECOND } from "../time";

export interface RulerTick {
  timeUs: Micros;
  /** Posição horizontal em pixels relativa ao início visível. */
  x: number;
  major: boolean;
}

/** Intervalos candidatos entre marcas principais, em segundos. */
const MAJOR_STEPS_S = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/**
 * Escolhe o menor intervalo principal que deixe pelo menos `minMajorPx`
 * pixels entre marcas principais.
 */
export function chooseMajorStepSeconds(pxPerSecond: number, minMajorPx = 80): number {
  if (!(pxPerSecond > 0)) throw new RangeError(`pxPerSecond inválido: ${pxPerSecond}`);
  return (
    MAJOR_STEPS_S.find((s) => s * pxPerSecond >= minMajorPx) ??
    MAJOR_STEPS_S[MAJOR_STEPS_S.length - 1]
  );
}

/**
 * Marcas da régua no intervalo [startUs, startUs + widthPx/pxPerSecond].
 * Cada intervalo principal é dividido em `minorPerMajor` partes.
 */
export function rulerTicks(
  startUs: Micros,
  widthPx: number,
  pxPerSecond: number,
  minorPerMajor = 5,
): RulerTick[] {
  if (widthPx <= 0) return [];
  const majorUs = chooseMajorStepSeconds(pxPerSecond) * US_PER_SECOND;
  const minorUs = majorUs / minorPerMajor;
  const endUs = startUs + (widthPx / pxPerSecond) * US_PER_SECOND;
  const firstIndex = Math.ceil(startUs / minorUs);
  const ticks: RulerTick[] = [];
  for (let i = firstIndex; i * minorUs <= endUs; i++) {
    const timeUs = Math.round(i * minorUs);
    ticks.push({
      timeUs,
      x: ((timeUs - startUs) / US_PER_SECOND) * pxPerSecond,
      major: i % minorPerMajor === 0,
    });
  }
  return ticks;
}
