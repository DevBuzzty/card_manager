import { assertEquals } from "jsr:@std/assert@1";
import { fakeSoldStore } from "./fake-sold-store.ts";

const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
Deno.test("fakeSoldStore: Kandidaten mit Grenze, Upsert je Druck, Statuszeile patchen", async () => {
  const f = fakeSoldStore({ candidates: [P, { ...P, card_id: "2" }] });
  assertEquals(await f.store.candidates(5, "2026-09-28T00:00:00Z", 1), [P]);
  assertEquals(f.candidateCalls, [{ minPrice: 5, freshBefore: "2026-09-28T00:00:00Z", limit: 1 }]);
  const row = { ...P, median_all: 7.5, n_all: 3, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "ok" as const, checked_at: "2026-10-05T00:00:00Z" };
  await f.store.upsert(row); await f.store.upsert({ ...row, n_all: 4 });
  assertEquals([f.rows.size, f.rows.get("1|SDJ-G001|DE|Ultra Rare")!.n_all], [1, 4]);
  assertEquals((await f.store.state()).access, "unbekannt");
  await f.store.setState({ access: "fehlt" });
  assertEquals(f.state.access, "fehlt");
});
