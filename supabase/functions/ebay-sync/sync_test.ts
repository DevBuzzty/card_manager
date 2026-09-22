// Spec H3b §8/§9/§10 -- Abgleicher mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { runSync } from "./sync.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account, fakeStore } from "../_shared/fake-store.ts";
import type { AspectDef, SollItem, SollListing } from "../_shared/ebay-map.ts";
import { ENDED_ON_EBAY, EXPIRED, SOLD_ON_EBAY } from "../_shared/ebay-plan.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const ENV: Record<string, string> = { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "sec", EBAY_SANDBOX_RUNAME: "ru" };
const ASPECTS: AspectDef[] = [
  { localizedAspectName: "Spiel", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Yu-Gi-Oh! TCG" }] },
  { localizedAspectName: "Kartenname", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
];
const L = (id: string, patch: Partial<SollListing> = {}): SollListing =>
  ({ listing_id: id, channel_id: "ebay", title: `Titel ${id}`, description: "Text", price: "10.00", status: "aktiv", deleted: false, ...patch });
const I = (listing: string, copy: string): SollItem => ({
  listing_id: listing, copy_id: copy, card_id: "46986414", name: "Dunkler Magier", set_code: "LOB-DE005", language: "DE",
  rarity: "Ultra Rare", edition: "first", condition: "NM", image_url: "https://images.ygoprodeck.com/images/cards/46986414.jpg", deleted: false,
});

function world(init: Parameters<typeof fakeStore>[0] = {}, ebay: FakeEbayOpts = {}) {
  const st = fakeStore({ listings: [L("l1")], items: [I("l1", "c1"), I("l1", "c2")], live: ["c1", "c2"], ...init });
  const eb = fakeEbay({ aspects: ASPECTS, ...ebay });
  let clock = NOW;
  const run = (retry: string | null = null, max?: number) =>
    runSync({ store: st.store, fetch: eb.fetchFn, env: (k) => ENV[k], now: () => clock, holder: "t" }, { retry, max });
  const later = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { ...st, eb, run, later };
}

Deno.test("einstellen: Inventar-Artikel, Offer, veröffentlichen -> online mit Link; Stand geschrieben", async () => {
  const w = world();
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.text, "1 eingestellt · 0 geändert · 0 beendet · 0 Fehler");
  const row = w.state.rows.get("l1")!;
  assertEquals([row.state, row.offer_id, row.item_id, row.item_url, row.published_qty, row.sku], ["online", "O1", "I2", "https://sandbox.ebay.de/itm/I2", 2, "L-l1"]);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price, { value: "5.00", currency: "EUR" });
  assertEquals(w.eb.items.get("L-l1").availability.shipToLocationAvailability.quantity, 2);
  assertEquals([w.state.account.last_run_at, w.state.account.last_error], ["2026-09-22T12:00:00.000Z", null]);
  assertEquals([w.state.lockHolder, w.state.unlocked], [null, 1]);
});

Deno.test("ändern: neuer Preis -> Offer aktualisiert, nichts neu angelegt; unverändert -> keine eBay-Aufrufe", async () => {
  const w = world();
  await w.run();
  w.state.listings[0] = L("l1", { price: "12.00" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.revised, 1);
  assertEquals(w.eb.offers.size, 1);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price.value, "6.00");
  const before = w.eb.ebayCalls().length;
  await w.run();
  assertEquals(w.eb.ebayCalls().length, before, "gleiche Prüfsumme, frisch geprüft: kein Aufruf");
});

Deno.test("Menge senken: Karte anderswo verkauft -> Menge 1", async () => {
  const w = world();
  await w.run();
  w.state.live.delete("c2");
  await w.run();
  assertEquals(w.eb.items.get("L-l1").availability.shipToLocationAvailability.quantity, 1);
  assertEquals(w.eb.offers.get("O1")!.body.availableQuantity, 1);
  assertEquals(w.state.rows.get("l1")!.published_qty, 1);
});

Deno.test("zurückziehen: Angebot beendet oder Menge 0 -> withdraw -> beendet", async () => {
  const w = world();
  await w.run();
  w.state.listings[0] = L("l1", { status: "verkauft" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.withdrawn, 1);
  assertEquals([w.state.rows.get("l1")!.state, w.eb.offers.get("O1")!.status], ["beendet", "UNPUBLISHED"]);
  const w2 = world();
  await w2.run();
  w2.state.live.clear();
  await w2.run();
  assertEquals(w2.state.rows.get("l1")!.state, "beendet");
});

Deno.test("manuell auf eBay beendet -> fehler, nicht wiederholt, Erneut versuchen stellt neu ein", async () => {
  const w = world();
  await w.run();
  w.eb.offers.get("O1")!.listing!.listingStatus = "ENDED";
  w.later(60 * 60 * 1000);
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", ENDED_ON_EBAY]);
  const before = w.eb.ebayCalls().length;
  await w.run();
  assertEquals(w.eb.ebayCalls().length, before, "Fehler ohne Änderung wird nicht wiederholt");
  await w.run("l1");
  assertEquals([w.state.rows.get("l1")!.state, w.eb.offers.get("O1")!.listing!.listingStatus], ["online", "ACTIVE"]);
});

Deno.test("auf eBay verkauft (soldQuantity) -> fehler vor dem Ändern; Erneut versuchen übernimmt die Zahl", async () => {
  const w = world();
  await w.run();
  w.eb.offers.get("O1")!.listing!.soldQuantity = 1;
  w.state.listings[0] = L("l1", { price: "11.00" });
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", SOLD_ON_EBAY]);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price.value, "5.00", "nichts überschrieben");
  await w.run("l1");
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.sold_seen], ["online", 1]);
});

Deno.test("Token abgelaufen/widerrufen -> getrennt, Hinweis, neue Angebote warten, keine Inventar-Aufrufe", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { refreshInvalid: true });
  const r = await w.run();
  assertEquals(r.ok, true);
  assertEquals([w.state.account.refresh_token, w.state.account.access_token, w.state.account.last_error], [null, null, EXPIRED]);
  assertEquals(w.state.rows.get("l1")!.state, "wartet");
  assertEquals(w.eb.ebayCalls().length, 0);
});

Deno.test("Einrichtung unvollständig -> wartet ohne eBay-Aufruf", async () => {
  const w = world({ account: account({ return_policy_id: null }) });
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.eb.ebayCalls().length], ["wartet", 0]);
});

Deno.test("Einzelfehler: abgelehnte Anzeige nur für dieses Angebot", async () => {
  const w = world({ listings: [L("l1"), L("l2")], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"] },
    { rejectPublish: { "L-l2": "Das Merkmal Sprache fehlt." } });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && [r.summary.published, r.summary.errors], [1, 1]);
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l2")!.state, w.state.rows.get("l2")!.error], ["online", "fehler", "Das Merkmal Sprache fehlt."]);
});

Deno.test("Pflichtmerkmal ohne Wert -> fehler ohne Veröffentlichen", async () => {
  const w = world({}, { aspects: [...ASPECTS, { localizedAspectName: "Charakter", aspectConstraint: { aspectRequired: true } }] });
  await w.run();
  assertEquals(w.state.rows.get("l1")!.error, "eBay verlangt das Merkmal „Charakter“.");
  assertEquals(w.eb.ebayCalls().length, 0);
});

Deno.test("zweiter paralleler Lauf -> „läuft schon“, keine Aufrufe", async () => {
  const w = world();
  w.state.lockHolder = "anderer";
  assertEquals(await w.run(), { ok: true, busy: true, text: "läuft schon" });
  assertEquals(w.eb.calls.length, 0);
});

Deno.test("eBay nicht erreichbar -> Durchgang bricht ab, letzter Fehler, Sperre frei, Zeilen unverändert", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { down: true });
  const r = await w.run();
  assertEquals([r.ok, w.state.account.last_error, w.state.rows.size, w.state.lockHolder], [false, "Service Unavailable", 0, null]);
  assertEquals(w.state.account.refresh_token, "RT", "vorübergehend: nicht trennen");
});

Deno.test("eBay mitten im Lauf überlastet -> Abbruch statt Einzelfehler, nichts gespeichert", async () => {
  const w = world({}, { publishDown: true });
  const r = await w.run();
  assertEquals([r.ok, w.state.account.last_error, w.state.rows.size, w.state.lockHolder], [false, "Service Unavailable", 0, null]);
});

Deno.test("höchstens N je Durchgang, Rest im nächsten Lauf", async () => {
  const w = world({ listings: [L("l1"), L("l2")], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"] });
  const r = await w.run(null, 1);
  assertEquals(r.ok && !r.busy && [r.summary.published, r.summary.deferred], [1, 1]);
  await w.run(null, 1);
  assertEquals(w.state.rows.get("l2")!.state, "online");
});

Deno.test("Zeile aus der Produktion wird nicht angefasst; in der Sandbox neu eingestellt", async () => {
  const prodRow = { listing_id: "l1", environment: "production", state: "online" as const, sku: "L-l1", offer_id: "P9", item_id: "X",
    item_url: "https://www.ebay.de/itm/X", published_qty: 2, synced_hash: "h", failed_hash: null, sold_seen: 0, error: null, synced_at: null };
  const w = world({ rows: [prodRow] });
  await w.run();
  assertEquals(w.eb.calls.some((c) => c.url.startsWith("https://api.ebay.com")), false);
  assertEquals([w.state.rows.get("l1")!.environment, w.state.rows.get("l1")!.offer_id], ["sandbox", "O1"]);
});
