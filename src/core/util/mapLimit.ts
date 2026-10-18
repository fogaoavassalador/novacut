export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Aplica `fn` a cada item com no máximo `limit` execuções simultâneas.
 * Nunca rejeita: cada resultado vem como sucesso ou erro, na ordem de entrada.
 */
export async function mapLimit<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  if (!(limit >= 1)) throw new RangeError(`limite inválido: ${limit}`);
  const results: Settled<O>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
