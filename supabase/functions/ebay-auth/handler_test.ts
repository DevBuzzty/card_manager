// Spec H3b §4.3/§9 -- ebay-auth mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { failPage, handleAuth, OK_PAGE } from "./handler.ts";
import { pick, resolveSetup } from "./setup.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account } from "../_shared/fake-store.ts";
import type { Account } from "../_shared/ebay-store.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const ENV: Record<string, string> = { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "sec", EBAY_SANDBOX_RUNAME: "ru" };
const FN = "https://proj.supabase.co/functions/v1/ebay-auth";

function setup(acc: Partial<Account> = {}, ebay: FakeEbayOpts = {}, user = true, liveOffers = 0) {
  const st = { account: account(acc) };
  const eb = fakeEbay(ebay);
  const d = {
    store: {
      account: () => Promise.resolve({ ...st.account }),
      saveAccount: (p: Partial<Account>) => { st.account = { ...st.account, ...p }; return Promise.resolve(); },
      liveOfferCount: (env: string) => Promise.resolve(env === st.account.environment ? liveOffers : 0),
    },
    fetch: eb.fetchFn, env: (k: string) => ENV[k], now: () => NOW,
    verifyUser: (h: string | null) => Promise.resolve(user && h === "Bearer JWT"), randomState: () => "state-123",
  };
  const post = (body: unknown) => handleAuth(new Request(FN, { method: "POST", headers: { Authorization: "Bearer JWT" }, body: JSON.stringify(body) }), d);
  const get = (q: string) => handleAuth(new Request(`${FN}?${q}`), d);
  return { st, eb, post, get };
}

Deno.test("ohne Anmeldung: 401, kein Zugriff", async () => {
  const w = setup({}, {}, false);
  const r = await w.post({ action: "start" });
  assertEquals([r.status, (await r.json()).error], [401, "Nicht angemeldet."]);
  assertEquals(w.eb.calls.length, 0);
});

Deno.test("start: state 10 Minuten gültig, Zustimmungs-URL der gespeicherten Umgebung", async () => {
  const w = setup({ refresh_token: null });
  const b = await (await w.post({ action: "start" })).json();
  assertEquals(b.ok, true);
  assertEquals(b.url.startsWith("https://auth.sandbox.ebay.com/oauth2/authorize?client_id=id&redirect_uri=ru&response_type=code&scope="), true);
  assertEquals(b.url.endsWith("&state=state-123"), true);
  assertEquals([w.st.account.oauth_state, w.st.account.oauth_state_expires_at], ["state-123", "2026-09-22T12:10:00.000Z"]);
});

Deno.test("Rücksprung: gültiger state -> Tokens gespeichert, state geleert, Einzel-Richtlinien gewählt, Textseite", async () => {
  const w = setup({ refresh_token: null, access_token: null, oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z",
    payment_policy_id: null, fulfillment_policy_id: null, return_policy_id: null, location_key: null },
    { locations: [{ key: "ygo-default", name: "Lager" }] });
  const r = await w.get("action=callback&state=state-123&code=abc&expires_in=299");
  assertEquals([r.status, r.headers.get("content-type"), await r.text()], [200, "text/plain; charset=utf-8", OK_PAGE]);
  const a = w.st.account;
  assertEquals([a.refresh_token, a.access_token, a.oauth_state, a.connected_at], ["RT", "AT", null, "2026-09-22T12:00:00.000Z"]);
  assertEquals([a.payment_policy_id, a.payment_policy_name, a.fulfillment_policy_id, a.return_policy_id, a.location_key],
    ["PAY1", "Richtlinie PAY1", "FUL1", "RET1", "ygo-default"]);
});

Deno.test("Rücksprung: falscher/abgelaufener state -> kein Tausch; abgelehnt -> Hinweis; state nur einmal", async () => {
  const bad = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z" });
  assertEquals(await (await bad.get("action=callback&state=falsch&code=abc")).text(),
    failPage("Anmeldelink abgelaufen oder ungültig – bitte in der App neu verbinden."));
  const old = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T11:59:00Z" });
  assertEquals((await old.get("action=callback&state=state-123&code=abc")).status, 400);
  assertEquals([bad.eb.calls.length, old.eb.calls.length], [0, 0]);
  const dec = setup();
  assertEquals(await (await dec.get("action=declined")).text(), failPage("bei eBay abgelehnt."));
  const once = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z" }, { codeInvalid: true });
  assertEquals(await (await once.get("state=state-123&code=abc")).text(), failPage("code expired"));
  assertEquals((await once.get("state=state-123&code=abc")).status, 400, "zweiter Versuch mit demselben state scheitert");
  assertEquals(once.eb.calls.length, 1);
});

Deno.test("check: mehrere Zahlungsrichtlinien -> keine Auswahl; select speichert ID und Namen; unbekannt -> Fehler", async () => {
  const w = setup({ payment_policy_id: null, location_key: null },
    { payment: [{ id: "P1", name: "PayPal" }, { id: "P2", name: "Überweisung" }], programs: [] });
  const c = await (await w.post({ action: "check" })).json();
  assertEquals([c.ok, c.programOk, c.payment.selected, c.payment.options.length, c.location.selected], [true, false, null, 2, null]);
  assertEquals(c.policyPage, "https://www.bizpolicy.sandbox.ebay.de/businesspolicy/manage");
  const s = await (await w.post({ action: "select", payment_policy_id: "P2" })).json();
  assertEquals([s.payment.selected, w.st.account.payment_policy_id, w.st.account.payment_policy_name], ["P2", "P2", "Überweisung"]);
  const x = await (await w.post({ action: "select", payment_policy_id: "P9" })).json();
  assertEquals(x, { ok: false, error: "Auswahl gibt es bei eBay nicht mehr – bitte neu prüfen." });
});

Deno.test("create_location: PLZ geprüft, Standort angelegt und gewählt", async () => {
  const w = setup({ location_key: null });
  assertEquals(await (await w.post({ action: "create_location", postal_code: "123", city: "Wien" })).json(),
    { ok: false, error: "Bitte eine fünfstellige Postleitzahl angeben." });
  const r = await (await w.post({ action: "create_location", postal_code: "80331", city: "München" })).json();
  assertEquals([r.ok, r.location.selected, w.st.account.location_key], [true, "ygo-default", "ygo-default"]);
  const call = w.eb.calls.find((c) => c.method === "POST" && c.url.endsWith("/sell/inventory/v1/location/ygo-default"))!;
  assertEquals(JSON.parse(call.body!).location.address, { postalCode: "80331", city: "München", country: "DE" });
});

Deno.test("set_environment verweigert, solange Anzeigen der alten Umgebung online sind", async () => {
  const w = setup({}, {}, true, 2);
  assertEquals(await (await w.post({ action: "set_environment", environment: "production" })).json(),
    { ok: false, error: "Zuerst die 2 eBay-Anzeigen in der Sandbox beenden – sonst bleiben sie dort online." });
  assertEquals([w.st.account.environment, w.st.account.refresh_token], ["sandbox", "RT"]);
});

Deno.test("set_environment trennt und leert die Einrichtung; disconnect löscht nur Tokens", async () => {
  const w = setup();
  assertEquals(await (await w.post({ action: "set_environment", environment: "production" })).json(), { ok: true });
  const a = w.st.account;
  assertEquals([a.environment, a.refresh_token, a.access_token, a.payment_policy_id, a.location_key], ["production", null, null, null, null]);
  const d = setup();
  await d.post({ action: "disconnect" });
  assertEquals([d.st.account.refresh_token, d.st.account.payment_policy_id], [null, "PAY1"]);
  assertEquals(await (await d.post({ action: "check" })).json(), { ok: false, error: "Nicht mit eBay verbunden." });
});

Deno.test("Einrichtung rein: bisherige Wahl bleibt, genau eine -> automatisch", () => {
  const o = [{ id: "A", name: "a" }, { id: "B", name: "b" }];
  assertEquals([pick(o, "B", undefined)?.id, pick(o, "X", undefined), pick([o[0]], null, undefined)?.id], ["B", null, "A"]);
  const r = resolveSetup({ payment: o, fulfillment: [o[0]], return: [], location: [] }, { payment: null, fulfillment: null, return: "R", location: null });
  assertEquals(r.patch, { payment_policy_id: null, payment_policy_name: null, fulfillment_policy_id: "A", fulfillment_policy_name: "a",
    return_policy_id: null, return_policy_name: null, location_key: null });
});
