// Plan H3b2 Task 6 -- Schritte 2/3 des Abgleichers mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { runSync } from "./sync.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account, type FakeListing, fakeStore } from "../_shared/fake-store.ts";
import type { AspectDef, SollItem } from "../_shared/ebay-map.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const ENV: Record<string, string> = { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "sec", EBAY_SANDBOX_RUNAME: "ru" };
const ASPECTS: AspectDef[] = [
  { localizedAspectName: "Spiel", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Yu-Gi-Oh! TCG" }] },
];
const L = (id: string, patch: Partial<FakeListing> = {}): FakeListing =>
  ({ listing_id: id, channel_id: "ebay", title: `Titel ${id}`, description: "Text", price: "10.00", status: "aktiv", deleted: false, ...patch });
const I = (listing: string, copy: string): SollItem => ({
  listing_id: listing, copy_id: copy, card_id: "46986414", name: "Dunkler Magier", set_code: "LOB-DE005", language: "DE",
  rarity: "Ultra Rare", edition: "unlimited", condition: "NM", image_url: "https://images.ygoprodeck.com/images/cards/46986414.jpg", deleted: false,
});
const amt = (v: string) => ({ value: v, currency: "EUR" });
const ORDER = (id: string, sku: string, qty: number, extra: Record<string, unknown> = {}) => ({
  orderId: id, creationDate: "2026-09-22T10:00:00.000Z", lastModifiedDate: "2026-09-22T10:00:00.000Z",
  orderPaymentStatus: "PAID", cancelStatus: { cancelState: "NONE_REQUESTED" },
  pricingSummary: { priceSubtotal: amt("5.00"), deliveryCost: amt("1.60") }, totalMarketplaceFee: amt("0.72"),
  lineItems: [{ lineItemId: "li1", sku, quantity: qty, lineItemCost: amt("5.00") }], ...extra,
});

function world(init: Parameters<typeof fakeStore>[0] = {}, ebay: FakeEbayOpts = {}) {
  const st = fakeStore({ listings: [L("l1")], items: [I("l1", "c1"), I("l1", "c2")], live: ["c1", "c2"], ...init });
  const opts: FakeEbayOpts = { aspects: ASPECTS, orders: [], transactions: {}, ...ebay };
  const eb = fakeEbay(opts);
  let clock = NOW;
  const run = () => runSync({ store: st.store, fetch: eb.fetchFn, env: (k) => ENV[k], now: () => clock, holder: "t" });
  const later = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { ...st, eb, opts, run, later };
}
const SALE = "ebay-sandbox-O-1";

Deno.test("Einzelverkauf: gebucht mit Preis+Versand und Gebühr, Angebot verkauft und auf eBay zurückgezogen", async () => {
  const w = world({ listings: [L("l1")], items: [I("l1", "c1")], live: ["c1"] });
  await w.run();
  assertEquals(w.state.rows.get("l1")!.state, "online");
  w.opts.orders = [ORDER("O-1", "L-l1", 1)];
  w.later(60_000);
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.text, "1 gebucht · 0 eingestellt · 0 geändert · 1 beendet · 0 Fehler");
  const s = w.state.sales.get(SALE)!;
  assertEquals([s.head.gross, s.head.fees, s.head.shipping, s.head.note, s.head.sold_on], [6.6, 0.72, null, "eBay-Bestellung O-1", "2026-09-22"]);
  assertEquals(s.items, [{ copy_id: "c1", value_at_sale: 2, share: 5.88 }]);
  assertEquals(w.state.live.has("c1"), false);
  assertEquals([w.state.listings[0].status, w.state.listings[0].sale_id], ["verkauft", SALE]);
  assertEquals(w.state.rows.get("l1")!.state, "beendet");
  assertEquals(w.state.orders.get("O-1"), {
    order_id: "O-1", environment: "sandbox", sale_id: SALE, status: "gebucht", fees_provisional: 0.72, fees_final: false, raw_total: 6.6, error: null,
  });
  assertEquals([...w.state.notices.keys()], [`ship-${SALE}`]);
  assertEquals(w.state.account.orders_cursor, "2026-09-22T10:00:00.000Z");
});

Deno.test("Teilverkauf 1 von 2: Rest = Stückpreis x Restmenge (A6), eBay-Menge und Preis im selben Lauf nachgezogen", async () => {
  const w = world();
  await w.run();
  w.opts.orders = [ORDER("O-1", "L-l1", 1)];
  w.eb.offers.get("O1")!.listing!.soldQuantity = 1; // wie echtes eBay nach dem Kauf
  w.later(60_000);
  await w.run();
  assertEquals([w.state.listings[0].status, w.state.listings[0].price], ["aktiv", "5.00"]);
  assertEquals(w.state.items.filter((i) => !i.deleted).map((i) => i.copy_id), ["c2"]);
  const row = w.state.rows.get("l1")!;
  assertEquals([row.state, row.published_qty, row.sold_seen, row.error], ["online", 1, 1, null]);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price.value, "5.00");
});

Deno.test("Bestellung doppelt geliefert (Überlappung) -> genau eine Buchung", async () => {
  const w = world({}, { orders: [ORDER("O-1", "L-l1", 1)] });
  await w.run();
  w.later(60_000);
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.booked, 0);
  assertEquals(w.state.sales.size, 1);
});

Deno.test("Abbruch nach book_sale, vor dem Merken -> Folgelauf bucht nicht erneut und nimmt dieselben Karten", async () => {
  const w = world({ live: ["c1", "c2"] }, { orders: [ORDER("O-1", "L-l1", 1)] });
  w.state.failSaveOrder = 1;
  const r1 = await w.run();
  assertEquals(r1.ok, false);
  assertEquals([w.state.sales.size, w.state.orders.size, w.state.account.orders_cursor], [1, 0, null]);
  const r2 = await w.run();
  assertEquals(r2.ok && !r2.busy && r2.summary.booked, 1);
  assertEquals(w.state.sales.size, 1);
  assertEquals(w.state.sales.get(SALE)!.items.map((i) => i.copy_id), ["c1"]);
  assertEquals(w.state.live.has("c2"), true, "keine zweite Karte verkauft");
  assertEquals(w.state.orders.get("O-1")!.status, "gebucht");
  // Das Angebot wurde im ersten Lauf schon angepasst -- der Wiederanlauf darf die übrige Karte nicht als verkauft werten.
  assertEquals([w.state.listings[0].status, w.state.listings[0].price], ["aktiv", "5.00"]);
  assertEquals(w.state.items.filter((i) => !i.deleted).map((i) => i.copy_id), ["c2"]);
});

Deno.test("Käufer-Storno nach der Buchung -> H2-Storno, Karte zurück, Hinweis mit Angebot", async () => {
  const w = world({}, { orders: [ORDER("O-1", "L-l1", 1)] });
  await w.run();
  w.opts.orders = [ORDER("O-1", "L-l1", 1, { lastModifiedDate: "2026-09-22T11:00:00.000Z", cancelStatus: { cancelState: "CANCELED" } })];
  w.later(60_000);
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.cancelled, 1);
  assertEquals([w.state.sales.get(SALE)!.head.status, w.state.live.has("c1"), w.state.orders.get("O-1")!.status], ["storniert", true, "storniert"]);
  assertEquals(w.state.notices.get(`cancel-${SALE}`)!.listing_id, "l1");
});

Deno.test("Storno vor der Buchung -> nur festgehalten, nichts gebucht", async () => {
  const w = world({}, { orders: [ORDER("O-1", "L-l1", 1, { cancelStatus: { cancelState: "CANCELED" } })] });
  await w.run();
  assertEquals([w.state.sales.size, w.state.orders.get("O-1")!.status, w.state.notices.size], [0, "storniert", 0]);
});

Deno.test("Karte inzwischen anderswo verkauft: bucht, was lebt, und meldet den Rest (§7.5)", async () => {
  const w = world({ live: ["c2"] }, { orders: [ORDER("O-1", "L-l1", 2)] });
  await w.run();
  assertEquals(w.state.sales.get(SALE)!.items.map((i) => i.copy_id), ["c2"]);
  assertEquals(w.state.notices.get(`missing-${SALE}`)!.text, "eBay-Bestellung O-1: 1 Karte schon anderswo verkauft – bitte prüfen");
});

Deno.test("keine lebende Karte -> fehler + Hinweis, kein Verkauf, kein neuer Versuch", async () => {
  const w = world({ live: [] }, { orders: [ORDER("O-1", "L-l1", 1)] });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.errors, 1);
  assertEquals([w.state.sales.size, w.state.orders.get("O-1")!.status], [0, "fehler"]);
  assertEquals(w.state.notices.has(`nocard-${SALE}`), true);
  w.later(60_000);
  await w.run();
  assertEquals(w.state.notices.size, 1);
});

Deno.test("fremde SKU -> fremd, nichts gebucht, kein Hinweis (A3)", async () => {
  const w = world({}, { orders: [ORDER("O-1", "EIGENE-SKU", 1)] });
  await w.run();
  assertEquals([w.state.sales.size, w.state.orders.get("O-1")!.status, w.state.notices.size], [0, "fremd", 0]);
});

Deno.test("Aufräumen: Karte auch auf Cardmarket angeboten -> dort herausgenommen, Angebot beendet, Erinnerung", async () => {
  const w = world({
    listings: [L("l1"), L("l9", { channel_id: "cardmarket", channel_name: "Cardmarket", title: null })],
    items: [I("l1", "c1"), I("l9", "c1")], live: ["c1"],
  }, { orders: [ORDER("O-1", "L-l1", 1)] });
  await w.run();
  assertEquals(w.state.listings.find((l) => l.listing_id === "l9")!.status, "beendet");
  assertEquals(w.state.notices.get(`remind-${SALE}-l9`)!.text, "eBay-Verkauf: auch dort herausnehmen – Cardmarket – 1× Dunkler Magier LOB-DE005");
});

Deno.test("Gebühren: Finanzdaten leer -> warten; da -> nachgetragen, Anteile neu, endgültig", async () => {
  const w = world({ items: [I("l1", "c1")], live: ["c1"] }, { orders: [ORDER("O-1", "L-l1", 1)] });
  await w.run();
  assertEquals(w.state.orders.get("O-1")!.fees_final, false);
  w.opts.transactions = { "O-1": [{ transactionType: "SALE", totalFeeAmount: amt("0.81") }] };
  w.later(60_000);
  await w.run();
  const s = w.state.sales.get(SALE)!;
  assertEquals([s.head.fees, s.items[0].share, w.state.orders.get("O-1")!.fees_final], [0.81, 5.79, true]);
});

Deno.test("Gebühren: vom Nutzer geändert -> bleibt, Marke fällt trotzdem weg (A2)", async () => {
  const w = world({ items: [I("l1", "c1")], live: ["c1"] }, { orders: [ORDER("O-1", "L-l1", 1)] });
  await w.run();
  w.state.sales.get(SALE)!.head.fees = 0.5;
  w.opts.transactions = { "O-1": [{ transactionType: "SALE", totalFeeAmount: amt("0.81") }] };
  w.later(60_000);
  await w.run();
  assertEquals([w.state.sales.get(SALE)!.head.fees, w.state.orders.get("O-1")!.fees_final], [0.5, true]);
});

Deno.test("erster Lauf beginnt beim Verbinden: ältere Bestellung wird nie gebucht (A4)", async () => {
  const old = ORDER("O-ALT", "L-l1", 1, { lastModifiedDate: "2026-08-31T23:00:00.000Z" });
  const w = world({ account: account({ connected_at: "2026-09-01T00:00:00Z" }) }, { orders: [old] });
  await w.run();
  assertEquals([w.state.sales.size, w.state.orders.size], [0, 0]);
  assertEquals(w.eb.calls.find((c) => c.url.includes("/sell/fulfillment/"))!.url.includes("2026-09-01T00%3A00%3A00.000Z"), true);
});

Deno.test("eBay-Bestellungen nicht erreichbar -> Lauf bricht ab, Cursor bleibt, nichts gebucht", async () => {
  const w = world({}, { orders: [ORDER("O-1", "L-l1", 1)], ordersDown: true });
  const r = await w.run();
  assertEquals(r.ok, false);
  assertEquals([w.state.sales.size, w.state.account.orders_cursor, w.state.lockHolder], [0, null, null]);
});

Deno.test("Token läuft in 30 Tagen ab -> ein Hinweis, auch über mehrere Läufe", async () => {
  const w = world({ account: account({ refresh_expires_at: "2026-10-10T00:00:00Z" }) });
  await w.run();
  w.later(60_000);
  await w.run();
  assertEquals([...w.state.notices.values()].map((n) => [n.notice_id, n.kind]), [["token-2026-10-10", "token"]]);
});

Deno.test("Finanzdaten nicht erreichbar -> Buchung und Angebots-Abgleich laufen trotzdem, Hinweis im letzten Fehler", async () => {
  const w = world({ items: [I("l1", "c1"), I("l1", "c2")], live: ["c1", "c2"] }, { orders: [ORDER("O-1", "L-l1", 1)], transactionsDown: true });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && [r.summary.booked, r.summary.published], [1, 1]);
  assertEquals(w.state.rows.get("l1")!.state, "online");
  assertEquals(w.state.orders.get("O-1")!.fees_final, false);
  assertEquals(w.state.account.last_error!.startsWith("Gebühren nicht lesbar:"), true);
});
