// Spec H3b §4.3/§9 -- eBay-Client gegen nachgebaute Antworten (kein Netz).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  categoryAspects, consentUrl, credsFor, EbayError, ebayApi, ensureAccess, exchangeCode, refreshAccess,
} from "./ebay-client.ts";
import { fakeFetch } from "./fake-fetch.ts";

const C = { clientId: "app-id", clientSecret: "geheim", ruName: "Ru-Name-1" };
const NOW = new Date("2026-09-22T12:00:00Z");
const TOKEN = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const API = "https://api.sandbox.ebay.com";

Deno.test("Zustimmungs-URL Sandbox/Produktion mit allen vier Rechten und state", () => {
  const scope = "https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.inventory+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.account+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.finances";
  assertEquals(consentUrl("sandbox", C, "s1"),
    `https://auth.sandbox.ebay.com/oauth2/authorize?client_id=app-id&redirect_uri=Ru-Name-1&response_type=code&scope=${scope}&state=s1`);
  assertEquals(consentUrl("production", C, "s1").startsWith("https://auth.ebay.com/oauth2/authorize?"), true);
});

Deno.test("Secrets je Umgebung; fehlend -> Einrichtungsfehler ohne Wert", () => {
  const env: Record<string, string> = { EBAY_PROD_CLIENT_ID: "a", EBAY_PROD_CLIENT_SECRET: "b", EBAY_PROD_RUNAME: "c" };
  assertEquals(credsFor("production", (k) => env[k]), { clientId: "a", clientSecret: "b", ruName: "c" });
  try { credsFor("sandbox", (k) => env[k]); throw new Error("kein Fehler"); }
  catch (e) { assertEquals((e as Error).message, "eBay-Zugangsdaten für Sandbox fehlen (Secrets EBAY_SANDBOX_…)."); }
});

Deno.test("Code tauschen: Basic-Kopf, Formular, Ablaufzeiten", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { body: { access_token: "AT", expires_in: 7200, refresh_token: "RT", refresh_token_expires_in: 47304000, token_type: "User Access Token" } } });
  const t = await exchangeCode(f.fetchFn, "sandbox", C, "v^1.1#i^1", NOW);
  assertEquals(t, { access_token: "AT", access_expires_at: "2026-09-22T14:00:00.000Z", refresh_token: "RT", refresh_expires_at: "2028-03-23T00:00:00.000Z" });
  assertEquals(f.calls[0].headers["authorization"], `Basic ${btoa("app-id:geheim")}`);
  assertEquals(f.calls[0].headers["content-type"], "application/x-www-form-urlencoded");
  assertEquals(f.calls[0].body, "grant_type=authorization_code&code=v%5E1.1%23i%5E1&redirect_uri=Ru-Name-1");
});

Deno.test("Token erneuern nur, wenn weniger als 5 Minuten übrig", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { body: { access_token: "AT2", expires_in: 7200 } } });
  const fresh = await ensureAccess(f.fetchFn, "sandbox", C, { access_token: "AT", access_expires_at: "2026-09-22T12:06:00Z", refresh_token: "RT" }, NOW);
  assertEquals([fresh.token, fresh.patch, f.calls.length], ["AT", null, 0]);
  const old = await ensureAccess(f.fetchFn, "sandbox", C, { access_token: "AT", access_expires_at: "2026-09-22T12:04:00Z", refresh_token: "RT" }, NOW);
  assertEquals(old, { token: "AT2", patch: { access_token: "AT2", access_expires_at: "2026-09-22T14:00:00.000Z" } });
  assertEquals(f.calls[0].body?.startsWith("grant_type=refresh_token&refresh_token=RT&scope="), true);
});

Deno.test("Fehler: invalid_grant = auth, 500/429 = vorübergehend, longMessage bevorzugt", async () => {
  const bad = fakeFetch({ [`POST ${TOKEN}`]: { status: 400, body: { error: "invalid_grant", error_description: "the provided authorization refresh token is invalid" } } });
  const e1 = await assertRejects(() => refreshAccess(bad.fetchFn, "sandbox", C, "RT", NOW), EbayError);
  assertEquals([e1.auth, e1.transient, e1.message], [true, false, "the provided authorization refresh token is invalid"]);
  const busy = fakeFetch({ [`GET ${API}/sell/inventory/v1/offer/O1`]: { status: 503, body: {} } });
  const e2 = await assertRejects(() => ebayApi(busy.fetchFn, "sandbox", "AT").getOffer("O1"), EbayError);
  assertEquals([e2.transient, e2.auth], [true, false]);
  const rej = fakeFetch({ [`POST ${API}/sell/inventory/v1/offer/O1/publish`]: { status: 400, body: { errors: [{ errorId: 25002, message: "kurz", longMessage: "Das Merkmal Spiel fehlt." }] } } });
  const e3 = await assertRejects(() => ebayApi(rej.fetchFn, "sandbox", "AT").publishOffer("O1"), EbayError);
  assertEquals([e3.message, e3.transient, e3.auth], ["Das Merkmal Spiel fehlt.", false, false]);
  const net = await assertRejects(() => ebayApi(() => Promise.reject(new Error("dns")), "sandbox", "AT").getOffer("O1"), EbayError);
  assertEquals(net.transient, true);
});

Deno.test("API-Aufrufe: Pfade, Kopfzeilen, 404 bei getOffers/getOffer", async () => {
  const f = fakeFetch({
    [`PUT ${API}/sell/inventory/v1/inventory_item/L-l1`]: { status: 204 },
    [`GET ${API}/sell/inventory/v1/offer?sku=L-l1&marketplace_id=EBAY_DE`]: { status: 404, body: { errors: [{ errorId: 25713 }] } },
    [`GET ${API}/sell/inventory/v1/offer/O9`]: { status: 404, body: {} },
    [`POST ${API}/sell/inventory/v1/offer`]: { status: 201, body: { offerId: "O1" } },
    [`GET ${API}/sell/account/v1/payment_policy?marketplace_id=EBAY_DE`]: { body: { paymentPolicies: [{ paymentPolicyId: "P1", name: "PayPal" }] } },
    [`GET ${API}/sell/inventory/v1/location?limit=100`]: { body: { locations: [{ merchantLocationKey: "ygo-default", name: "Lager", merchantLocationStatus: "ENABLED" }, { merchantLocationKey: "alt", merchantLocationStatus: "DISABLED" }] } },
  });
  const api = ebayApi(f.fetchFn, "sandbox", "AT");
  await api.putInventoryItem("L-l1", { a: 1 });
  assertEquals(await api.getOffers("L-l1"), []);
  assertEquals(await api.getOffer("O9"), null);
  assertEquals(await api.createOffer({}), "O1");
  assertEquals(await api.paymentPolicies(), [{ id: "P1", name: "PayPal" }]);
  assertEquals(await api.locations(), [{ id: "ygo-default", name: "Lager" }]);
  assertEquals(f.calls[0].headers["content-language"], "de-DE");
  assertEquals(f.calls[0].headers["authorization"], "Bearer AT");
  assertEquals(f.calls[0].body, '{"a":1}');
});

Deno.test("Taxonomy: Baum-ID holen, dann Merkmale der Kategorie", async () => {
  const base = "https://api.sandbox.ebay.com/commerce/taxonomy/v1";
  const f = fakeFetch({
    [`GET ${base}/get_default_category_tree_id?marketplace_id=EBAY_DE`]: { body: { categoryTreeId: "77", categoryTreeVersion: "129" } },
    [`GET ${base}/category_tree/77/get_item_aspects_for_category?category_id=183454`]: { body: { aspects: [{ localizedAspectName: "Spiel" }] } },
  });
  assertEquals(await categoryAspects(f.fetchFn, "sandbox", "APP", "183454"), [{ localizedAspectName: "Spiel" }]);
  assertEquals(f.calls.map((c) => c.headers["authorization"]), ["Bearer APP", "Bearer APP"]);
});
