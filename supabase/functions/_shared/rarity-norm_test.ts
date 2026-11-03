// Spec 2026-11-03 §3.3/§9.2 -- RarityNorm gegen die geteilte Fixture (Twin: Kotlin RarityNormTest).
import { assertEquals } from "jsr:@std/assert@1";
import { RarityNorm } from "./rarity-norm.ts";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/rarity-norm.json", import.meta.url)));

Deno.test("RarityNorm.key: alle Fixture-Fälle", () => {
  for (const c of fx.keys) assertEquals(RarityNorm.key(c.in), c.key, `in=${JSON.stringify(c.in)}`);
});

Deno.test("RarityNorm.gleich: alle Fixture-Paare", () => {
  for (const c of fx.gleich) assertEquals(RarityNorm.gleich(c.a, c.b), c.gleich, `${c.a} / ${c.b}`);
});
