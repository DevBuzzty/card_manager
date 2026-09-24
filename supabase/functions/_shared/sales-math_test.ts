// Spec H3b §10 -- Deno-Zwilling gegen dieselbe Fixture wie sales-math.cjs / saleMath.js / SalesMath.kt.
import { assertEquals } from "jsr:@std/assert@1";
import { CONDITION_FACTORS } from "./condition-factors.ts";
import { distribute, feeDefaultCents, marketValueCents, netCents } from "./sales-math.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/sales/sales.json", import.meta.url)));

Deno.test("Zustandsfaktoren = desktop/electron/condition-factors.json", async () => {
  const json = JSON.parse(await Deno.readTextFile(new URL("../../../desktop/electron/condition-factors.json", import.meta.url)));
  assertEquals(CONDITION_FACTORS, json);
});

Deno.test("Marktwert wie H2 (alle Fixture-Fälle)", () => {
  for (const c of F.marketValue) assertEquals(marketValueCents(c.card, c.copy), c.cents, c.name);
});

Deno.test("Netto wie H2 (alle Fixture-Fälle)", () => {
  for (const c of F.net) assertEquals(netCents(c.sale), c.cents, JSON.stringify(c.sale));
});

Deno.test("Gebühren-Vorschlag wie H2 (alle Fixture-Fälle)", () => {
  for (const c of F.feeDefault) assertEquals(feeDefaultCents(c.grossCents, c.percent), c.cents, JSON.stringify(c));
});

Deno.test("Aufteilung wie H2 (alle Fixture-Fälle)", () => {
  for (const c of F.distribute) assertEquals(distribute(c.net, c.values), c.shares, c.name);
});
