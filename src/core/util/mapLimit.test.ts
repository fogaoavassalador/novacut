import { describe, expect, it } from "vitest";
import { mapLimit } from "./mapLimit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("preserva a ordem e nunca passa do limite de concorrência", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10, 2], 2, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(ms);
      running--;
      return i * 10;
    });
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual([0, 10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it("captura erros individualmente sem abortar os demais", async () => {
    const out = await mapLimit(["a", "b", "c"], 3, async (s) => {
      if (s === "b") throw new Error("falhou b");
      return s.toUpperCase();
    });
    expect(out[0]).toEqual({ ok: true, value: "A" });
    expect(out[1].ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: "C" });
  });

  it("lista vazia e limite inválido", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow(RangeError);
  });
});
