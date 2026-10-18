import { useCallback, useEffect, useRef, useState } from "react";
import type { Micros } from "../core/time";

/**
 * Relógio de reprodução. Enquanto toca, avança o playhead a cada quadro de
 * tela pelo relógio do sistema; os elementos de mídia são sincronizados a ele.
 * Se o playhead for movido durante a reprodução (régua, setas), o relógio
 * passa a contar a partir da nova posição.
 */
export function usePlayback(durationUs: Micros, playheadUs: Micros, setPlayhead: (us: Micros) => void) {
  const [playing, setPlaying] = useState(false);
  const clock = useRef({ wall: 0, t: 0 });
  const lastTick = useRef<Micros | null>(null);
  const durationRef = useRef(durationUs);
  durationRef.current = durationUs;

  // Reancora o relógio se o playhead mudou por fora do tick.
  useEffect(() => {
    if (playing && playheadUs !== lastTick.current) clock.current = { wall: performance.now(), t: playheadUs };
  }, [playing, playheadUs]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const t = clock.current.t + (performance.now() - clock.current.wall) * 1000;
      if (t >= durationRef.current) {
        lastTick.current = durationRef.current;
        setPlayhead(durationRef.current);
        setPlaying(false);
        return;
      }
      lastTick.current = Math.round(t);
      setPlayhead(lastTick.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlayhead]);

  const play = useCallback(() => {
    if (durationRef.current <= 0) return;
    // No fim, tocar de novo recomeça do início.
    const start = playheadUs >= durationRef.current ? 0 : playheadUs;
    if (start !== playheadUs) setPlayhead(start);
    clock.current = { wall: performance.now(), t: start };
    lastTick.current = start;
    setPlaying(true);
  }, [playheadUs, setPlayhead]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  return { playing, play, pause, toggle };
}
