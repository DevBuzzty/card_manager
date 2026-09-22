// Spec H3b §5.3/§8/§9 -- Entscheidungstabelle des Abgleichers gegen docs/fixtures/ebay/plan.json.
import { assertEquals } from "jsr:@std/assert@1";
import { decide, type EbayRow, offerEnded, summaryText } from "./ebay-plan.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/ebay/plan.json", import.meta.url)));
const row = (k: string | null): EbayRow | null =>
  k == null ? null : { sku: null, item_id: null, item_url: null, published_qty: null, error: null, ...F.rows[k] };

Deno.test("decide: alle Fälle der Tabelle", () => {
  for (const c of F.cases) {
    const got = decide({ active: c.active, hash: c.hash, row: row(c.row), env: "sandbox", connected: c.connected,
      setupOk: c.setupOk, retry: c.retry, nowMs: F.nowMs });
    assertEquals(got, c.action, c.name);
  }
});

Deno.test("offerEnded: nur PUBLISHED mit ACTIVE/OUT_OF_STOCK lebt", () => {
  for (const c of F.ended) assertEquals(offerEnded(c.offer), c.ended, JSON.stringify(c.offer));
});

Deno.test("summaryText", () => {
  for (const c of F.summaries) assertEquals(summaryText(c.s), c.text);
});
