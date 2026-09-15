import { assertEquals } from "jsr:@std/assert@1";
import { armedUpdatesAfterInsert, evaluate, type EvaluateInput } from "./alerts.ts";

// Spec G2 §10 — Faelle in docs/fixtures/portfolio/alerts.json.
const FIX = JSON.parse(
  await Deno.readTextFile(new URL("../../../docs/fixtures/portfolio/alerts.json", import.meta.url)),
) as { cases: { name: string; input: EvaluateInput; expected: unknown }[] };

for (const c of FIX.cases) {
  Deno.test(`alerts: ${c.name}`, () => {
    assertEquals(evaluate(c.input), c.expected);
  });
}

// Spec G2 §5.4 — armed:false wird nur uebernommen, wenn der Treffer tatsaechlich eingefuegt wurde.
Deno.test("armedUpdatesAfterInsert: armed:false bleibt, wenn die Regel eingefuegt wurde", () => {
  assertEquals(
    armedUpdatesAfterInsert([{ id: 1, armed: false }], new Set([1])),
    [{ id: 1, armed: false }],
  );
});

Deno.test("armedUpdatesAfterInsert: armed:false faellt weg, wenn der Treffer eine Dublette war", () => {
  assertEquals(
    armedUpdatesAfterInsert([{ id: 1, armed: false }], new Set()),
    [],
  );
});

Deno.test("armedUpdatesAfterInsert: armed:true bleibt immer, unabhaengig von insertedRuleIds", () => {
  assertEquals(
    armedUpdatesAfterInsert([{ id: 1, armed: true }, { id: 2, armed: false }], new Set()),
    [{ id: 1, armed: true }],
  );
});
