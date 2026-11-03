// Spec 2026-11-03 §5.5/§9.5 -- Block-Regel gegen docs/fixtures/cm-resolve/blocks.json (unabhängig von BLOCKS_AKTIV).
import { assertEquals } from "jsr:@std/assert@1";
import { blockRegel } from "./blocks.ts";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/cm-resolve/blocks.json", import.meta.url)));

for (const c of fx.cases) {
  Deno.test(`blocks.json: ${c.name}`, () => {
    const gruppen = new Map<number, number[]>(Object.entries(c.versionGroups as Record<string, number[]>).map(([e, ids]) => [Number(e), ids]));
    assertEquals(blockRegel({ gruppen, printingRarities: c.printingRarities, rk: c.rk, blocks: c.blocks }), c.expect);
  });
}
