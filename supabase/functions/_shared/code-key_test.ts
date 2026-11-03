// Spec 2026-11-03 §3.2/§9.1 -- CodeKey gegen die geteilte Fixture (Twin: Kotlin CodeKeyTest).
import { assertEquals } from "jsr:@std/assert@1";
import { CodeKey } from "./code-key.ts";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/code-key.json", import.meta.url)));

Deno.test("CodeKey.of: alle Fixture-Fälle", () => {
  for (const c of fx.cases) assertEquals(CodeKey.of(c.in), c.key, `in=${JSON.stringify(c.in)}`);
});
