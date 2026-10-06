import { assertEquals } from "jsr:@std/assert@1";
import { handleSold } from "./handler.ts";
import type { RunOpts } from "./run.ts";

const FN = "https://x/functions/v1/ebay-sold-prices";
function world(cronSecret: string | undefined = "s3cret") {
  const runs: RunOpts[] = [];
  const d = { cronSecret, verifyUser: (h: string | null) => Promise.resolve(h === "Bearer JWT"),
    run: (o: RunOpts) => { runs.push(o); return Promise.resolve({ ok: true, access: "aktiv" as const, checked: 0 }); } };
  return { runs, d };
}
const req = (headers: Record<string, string>, body: unknown, method = "POST") => new Request(FN, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };

Deno.test("Zeitplan mit Secret: cron mit Standardwerten bzw. Body-Werten in Grenzen", async () => {
  const w = world();
  await handleSold(req({ "x-ebay-secret": "s3cret" }, {}), w.d);
  await handleSold(req({ "x-ebay-secret": "s3cret" }, { minPrice: 10, budget: 9999 }), w.d);
  assertEquals(w.runs, [{ mode: "cron", minPrice: 5, budget: 50 }, { mode: "cron", minPrice: 10, budget: 500 }]);
});

Deno.test("Angemeldeter Nutzer: nur Einzelabruf; ohne gültigen Druck 400; nie Zeitplan", async () => {
  const w = world();
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { printing: P }), w.d)).status, 200);
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { minPrice: 1 }), w.d)).status, 400);
  assertEquals((await handleSold(req({ authorization: "Bearer JWT" }, { printing: { ...P, set_code: "" } }), w.d)).status, 400);
  assertEquals(w.runs, [{ mode: "single", printing: P }]);
});

Deno.test("Ohne Secret und ohne Login 401; falsches Secret 401; ohne gesetztes Secret ist der Zeitplan zu; nur POST", async () => {
  const w = world();
  assertEquals((await handleSold(req({}, {}), w.d)).status, 401);
  assertEquals((await handleSold(req({ "x-ebay-secret": "falsch" }, {}), w.d)).status, 401);
  assertEquals((await handleSold(req({ "x-ebay-secret": "" }, {}), world(undefined).d)).status, 401);
  assertEquals((await handleSold(req({}, null, "GET"), w.d)).status, 405);
  assertEquals(w.runs.length, 0);
});
