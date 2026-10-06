import { assertEquals } from "jsr:@std/assert@1";
import { fakeFetch } from "../_shared/fake-fetch.ts";
import { fakeSoldStore } from "./fake-sold-store.ts";
import { runSold, YGO_CATEGORY_ID } from "./run.ts";

const NOW = new Date("2026-10-05T04:30:00Z");
const ENV: Record<string, string> = { EBAY_PROD_CLIENT_ID: "id", EBAY_PROD_CLIENT_SECRET: "sec", EBAY_PROD_RUNAME: "ru" };
const TOKEN = "https://api.ebay.com/identity/v1/oauth2/token";
const SOLD = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const P1 = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
const P2 = { card_id: "2", set_code: "MAMO-DE020", language: "DE", rarity: "Ultra Rare" };
const sale = (code: string, price: number, day: number) =>
  ({ itemId: `${code}-${price}`, title: `Karte ${code}`, lastSoldPrice: { value: String(price), currency: "EUR" }, lastSoldDate: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, itemWebUrl: "https://www.ebay.de/itm/1", conditionId: "4000" });
const tokenOk = { body: { access_token: "AT", expires_in: 7200 } };
const salesFor = (c: { url: string }) => {
  const q = new URL(c.url).searchParams.get("q");
  return { body: { itemSales: q === "SDJ-G001" ? [sale("SDJ-G001", 5, 1), sale("SDJ-G001", 6, 2), sale("SDJ-G001", 7, 3)] : [sale("MAMO-DE020", 60, 4)] } };
};
const deps = (st: ReturnType<typeof fakeSoldStore>, f: ReturnType<typeof fakeFetch>) => ({ store: st.store, fetch: f.fetchFn, env: (k: string) => ENV[k], now: () => NOW });

Deno.test("Scope fehlt -> access fehlt, keine Suche, keine Kandidatenabfrage, nichts gespeichert", async () => {
  const st = fakeSoldStore({ candidates: [P1] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: { status: 400, body: { error: "invalid_scope" } } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, r.checked], [false, "fehlt", 0]);
  assertEquals([st.state.access, st.state.last_run_at, st.candidateCalls.length, st.rows.size], ["fehlt", NOW.toISOString(), 0, 0]);
  assertEquals(f.calls.filter((c) => c.url.startsWith(SOLD)).length, 0);
});

Deno.test("Scope da -> aktiv; Kandidaten mit Frist 7 Tage und Budget; Werte gespeichert; Zähler", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2], state: { access: "fehlt", last_error: "alt", calls_day: "2026-10-05", calls_today: 3 } });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, r.checked], [true, "aktiv", 2]);
  assertEquals(st.candidateCalls, [{ minPrice: 5, freshBefore: "2026-09-28T04:30:00.000Z", limit: 50 }]);
  const a = st.rows.get("1|SDJ-G001|DE|Ultra Rare")!, b = st.rows.get("2|MAMO-DE020|DE|Ultra Rare")!;
  assertEquals([a.status, a.median_all, a.n_all, a.checked_at], ["ok", 6, 3, NOW.toISOString()]);
  assertEquals([b.status, b.median_all, b.n_all], ["zu_wenig", null, 1]);
  assertEquals([st.state.access, st.state.last_error, st.state.calls_today, st.state.calls_day], ["aktiv", null, 5, "2026-10-05"]);
  assertEquals(new URL(f.calls.find((c) => c.url.startsWith(SOLD))!.url).searchParams.get("category_ids"), YGO_CATEGORY_ID);
});

Deno.test("Tageswechsel setzt calls_today zurück", async () => {
  const st = fakeSoldStore({ candidates: [P1], state: { calls_day: "2026-10-04", calls_today: 40 } });
  await runSold(deps(st, fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor })), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([st.state.calls_today, st.state.calls_day], [1, "2026-10-05"]);
});

Deno.test("429 an der Suche: Lauf bricht ab, bisherige bleiben, last_error gesetzt, kein fehler-Status", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => new URL(c.url).searchParams.get("q") === "SDJ-G001" ? salesFor(c) : { status: 429, body: {} } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked, st.rows.size], [false, 1, 1]);
  assertEquals(typeof st.state.last_error, "string");
});

Deno.test("403 an der Suche (Scope entzogen): access fehlt, Lauf endet, kein Druck auf fehler", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: { status: 403, body: { errors: [{ message: "Insufficient permissions" }] } } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, st.state.access, st.rows.size], [false, "fehlt", "fehlt", 0]);
});

Deno.test("401 an der Suche: Token einmal neu, dann weiter", async () => {
  const st = fakeSoldStore({ candidates: [P1] });
  let n = 0;
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => (++n === 1 ? { status: 401, body: {} } : salesFor(c)) });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked, f.calls.filter((c) => c.url === TOKEN).length], [true, 1, 2]);
});

Deno.test("Unerwartete Antwort bei einem Druck: status fehler mit Zeitstempel, nächster läuft weiter", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: (c) => new URL(c.url).searchParams.get("q") === "SDJ-G001" ? { status: 400, body: { errors: [{ message: "bad q" }] } } : salesFor(c) });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.checked], [true, 2]);
  const a = st.rows.get("1|SDJ-G001|DE|Ultra Rare")!;
  assertEquals([a.status, a.checked_at, a.n_all], ["fehler", NOW.toISOString(), 0]);
});

Deno.test("Einzelabruf: nur dieser Druck, ohne Kandidatenabfrage; Antwort enthält die Zeile", async () => {
  const st = fakeSoldStore({ candidates: [P2] });
  const r = await runSold(deps(st, fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor })), { mode: "single", printing: P1 });
  assertEquals([r.ok, r.checked, st.candidateCalls.length, r.row?.median_all], [true, 1, 0, 6]);
});

Deno.test("Secrets fehlen: Einrichtungsfehler in last_error, kein Netz", async () => {
  const st = fakeSoldStore();
  const f = fakeFetch({});
  const r = await runSold({ store: st.store, fetch: f.fetchFn, env: () => undefined, now: () => NOW }, { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, f.calls.length], [false, 0]);
  assertEquals(st.state.last_error?.includes("fehlen"), true);
});

Deno.test("Fix1: Store-Fehler beim Speichern -> Lauf endet mit last_error, Zähler und last_run_at gesetzt", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  st.store.upsert = () => Promise.reject(new Error("db weg"));
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, r.checked], [false, "aktiv", 0]);
  assertEquals(st.state.last_error?.includes("db weg"), true);
  assertEquals([st.state.calls_today, st.state.last_run_at], [1, NOW.toISOString()]);
});

Deno.test("Fix2a: 401 an der Suche, Token-Erneuerung scheitert -> Lauf endet, keine Zeilen, last_error", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  let t = 0;
  const f = fakeFetch({
    [`POST ${TOKEN}`]: () => (++t === 1 ? tokenOk : { status: 401, body: { error: "invalid_client" } }),
    [`GET ${SOLD}`]: { status: 401, body: {} },
  });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, st.rows.size], [false, "aktiv", 0]);
  assertEquals(typeof st.state.last_error, "string");
});

Deno.test("Fix2b: 401 auch nach Erneuerung -> Lauf endet, keine fehler-Zeile", async () => {
  const st = fakeSoldStore({ candidates: [P1, P2] });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: { status: 401, body: {} } });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, st.rows.size], [false, "aktiv", 0]);
  assertEquals(typeof st.state.last_error, "string");
});

Deno.test("Fix2c: 401, Erneuerung liefert invalid_scope -> access fehlt", async () => {
  const st = fakeSoldStore({ candidates: [P1] });
  let t = 0;
  const f = fakeFetch({
    [`POST ${TOKEN}`]: () => (++t === 1 ? tokenOk : { status: 400, body: { error: "invalid_scope" } }),
    [`GET ${SOLD}`]: { status: 401, body: {} },
  });
  const r = await runSold(deps(st, f), { mode: "cron", minPrice: 5, budget: 50 });
  assertEquals([r.ok, r.access, st.state.access, st.rows.size], [false, "fehlt", "fehlt", 0]);
});

Deno.test("Einzelprüfung lässt last_error/last_run_at des Cron-Laufs unangetastet", async () => {
  const st = fakeSoldStore({ state: { access: "aktiv", last_error: "429 alt", last_run_at: "2026-10-05T01:00:00.000Z", calls_day: "2026-10-05", calls_today: 3 } });
  const f = fakeFetch({ [`POST ${TOKEN}`]: tokenOk, [`GET ${SOLD}`]: salesFor });
  const r = await runSold(deps(st, f), { mode: "single", printing: P1 });
  assertEquals(r.ok, true);
  assertEquals([st.state.last_error, st.state.last_run_at, st.state.calls_today], ["429 alt", "2026-10-05T01:00:00.000Z", 4]);
});
