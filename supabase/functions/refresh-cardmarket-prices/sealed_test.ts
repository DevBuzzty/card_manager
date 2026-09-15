import { assertEquals } from "jsr:@std/assert@1";
import { pickSealedUpdates, type SealedRow } from "./sealed.ts";

// Spec G3 §10 — ZWILLING: desktop/electron/sealed-prices.test.cjs liest dieselbe Fixture.
const FIX = JSON.parse(
  await Deno.readTextFile(new URL("../../../docs/fixtures/portfolio/sealed-prices.json", import.meta.url)),
) as { cases: { name: string; items: SealedRow[]; guide: unknown; expected: unknown }[] };

for (const c of FIX.cases) {
  Deno.test(`sealed: ${c.name}`, () => {
    assertEquals(pickSealedUpdates(c.items, c.guide), c.expected);
  });
}
