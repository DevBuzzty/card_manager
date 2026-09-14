import { assertEquals } from "jsr:@std/assert@1";
import { evaluate, type EvaluateInput } from "./alerts.ts";

// Spec G2 §10 — Faelle in docs/fixtures/portfolio/alerts.json.
const FIX = JSON.parse(
  await Deno.readTextFile(new URL("../../../docs/fixtures/portfolio/alerts.json", import.meta.url)),
) as { cases: { name: string; input: EvaluateInput; expected: unknown }[] };

for (const c of FIX.cases) {
  Deno.test(`alerts: ${c.name}`, () => {
    assertEquals(evaluate(c.input), c.expected);
  });
}
