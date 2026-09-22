// Spec H3b §8/§9/§10 -- Abgleicher mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { RUN_BUDGET_MS, runSync } from "./sync.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account, fakeStore } from "../_shared/fake-store.ts";
import type { AspectDef, SollItem, SollListing } from "../_shared/ebay-map.ts";
import { ENDED_ON_EBAY, EXPIRED, SOLD_ON_EBAY } from "../_shared/ebay-plan.ts";
import type { Store } from "../_shared/ebay-store.ts";

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

// -- Abschluss-Fix A1: verkauft UND beendet -> SOLD_ON_EBAY, nie "erneut einstellen" (Doppelverkauf) -----------

Deno.test("verkauft und beendet (Änderung) -> SOLD_ON_EBAY statt ENDED_ON_EBAY; Erneut versuchen stellt nicht mit alter Menge neu ein", async () => {
  const w = world();
  await w.run();
  const o = w.eb.offers.get("O1")!;
  o.listing!.soldQuantity = 2;
  o.listing!.listingStatus = "ENDED";
  w.state.listings[0] = L("l1", { price: "11.00" });
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", SOLD_ON_EBAY]);
  assertEquals(o.body.pricingSummary.price.value, "5.00", "nichts überschrieben");
  assertEquals(o.listing!.listingStatus, "ENDED", "nicht neu eingestellt");
});

Deno.test("verkauft und beendet (Prüfung ohne Änderung) -> SOLD_ON_EBAY statt ENDED_ON_EBAY", async () => {
  const w = world();
  await w.run();
  const o = w.eb.offers.get("O1")!;
  o.listing!.soldQuantity = 2;
  o.listing!.listingStatus = "ENDED";
  w.later(60 * 60 * 1000);
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", SOLD_ON_EBAY]);
  assertEquals(o.listing!.listingStatus, "ENDED");
});

Deno.test("Abschluss-Fix A3: Laufbudget 60 s", () => {
  assertEquals(RUN_BUDGET_MS, 60_000);
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

// -- Fixrunde 1 (Task 5) --------------------------------------------------------------------------------------

Deno.test("Zeitbudget überschritten -> Rest als deferred, nicht bearbeitet", async () => {
  const st = fakeStore({ listings: [L("l1"), L("l2")], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"] });
  const eb = fakeEbay({ aspects: ASPECTS });
  let calls = 0;
  // Erster Aufruf = Laufstart, zweiter = Fristprüfung für l1 (noch innerhalb der Frist), dritter = Fristprüfung
  // für l2 (Frist überschritten) -- eine Uhr, die mit jedem Aufruf "vergeht", statt eines festen Werts.
  const now = () => { calls++; return calls <= 2 ? NOW : new Date(NOW.getTime() + RUN_BUDGET_MS + 1); };
  const r = await runSync({ store: st.store, fetch: eb.fetchFn, env: (k) => ENV[k], now, holder: "t" });
  assertEquals(r.ok && !r.busy && [r.summary.published, r.summary.deferred], [1, 1]);
  assertEquals(st.state.rows.get("l1")!.state, "online");
  assertEquals(st.state.rows.has("l2"), false);
});

Deno.test("EXPIRED bleibt stehen, solange nicht neu verbunden statt am Laufende auf null überschrieben", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { refreshInvalid: true });
  await w.run();
  assertEquals(w.state.account.last_error, EXPIRED);
  await w.run();
  assertEquals(w.state.account.last_error, EXPIRED, "zweiter Lauf ohne neue Verbindung löscht den Hinweis nicht");
});

Deno.test("dauerhafter Merkmale-Fehler betrifft nur seine Kategorie; andere Aktionen laufen weiter", async () => {
  const prodRow = { listing_id: "l3", environment: "sandbox", state: "online" as const, sku: "L-l3", offer_id: "O9", item_id: "I9",
    item_url: "https://sandbox.ebay.de/itm/I9", published_qty: 1, synced_hash: "h", failed_hash: null, sold_seen: 0, error: null, synced_at: null };
  const w = world(
    { listings: [L("l1"), L("l2", { price: "20.00" })], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"], rows: [prodRow] },
    { aspectsError: { status: 400, message: "Unbekannte Kategorie." } },
  );
  // l3 ist nicht mehr im Soll (kein Listing) -> soll zurückgezogen werden; das darf trotz kaputter Merkmale klappen.
  w.eb.offers.set("O9", { offerId: "O9", sku: "L-l3", marketplaceId: "EBAY_DE", status: "PUBLISHED",
    body: {}, listing: { listingId: "I9", listingStatus: "ACTIVE", soldQuantity: 0 } });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && [r.summary.errors, r.summary.published, r.summary.withdrawn], [2, 0, 1]);
  assertEquals(w.state.rows.get("l1")!.error, "eBay-Merkmale nicht lesbar: Unbekannte Kategorie.");
  assertEquals(w.state.rows.get("l2")!.error, "eBay-Merkmale nicht lesbar: Unbekannte Kategorie.");
  assertEquals(w.state.rows.get("l3")!.state, "beendet");
});

// Fixrunde 2 (Task 5) Important 1: der bisherige Test nahm an, ein fehlgeschlagenes Zurückziehen sei immer schon
// "beendet" -- Doppelverkaufsrisiko, wenn die Anzeige in Wahrheit noch aktiv ist. Ersetzt durch zwei Fälle:
// (a) danach wirklich beendet -> beendet; (b) danach weiter aktiv -> fehler, nächster Lauf versucht es erneut.
Deno.test("Zurückziehen scheitert, Anzeige bei eBay inzwischen wirklich beendet -> lokal beendet", async () => {
  const w = world({}, { withdrawError: "Angebot ist nicht aktiv.", withdrawEndsAnyway: true });
  await w.run();
  w.state.listings[0] = L("l1", { status: "verkauft" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.withdrawn, 1);
  assertEquals(w.state.rows.get("l1")!.state, "beendet");
});

Deno.test("Zurückziehen scheitert, Anzeige bei eBay weiter aktiv -> fehler statt beendet (kein Doppelverkaufsrisiko), nächster Lauf versucht erneut", async () => {
  const w = world({}, { withdrawError: "Angebot ist nicht aktiv." });
  await w.run();
  w.state.listings[0] = L("l1", { status: "verkauft" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && [r.summary.errors, r.summary.withdrawn], [1, 0]);
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", "Angebot ist nicht aktiv."]);
  assertEquals(w.eb.offers.get("O1")!.listing!.listingStatus, "ACTIVE", "Anzeige bleibt live, nicht als beendet verbucht");
  const before = w.eb.ebayCalls().length;
  await w.run();
  assertEquals(w.eb.ebayCalls().length > before, true, "fehler (nicht beendet) -> wird erneut versucht");
});

Deno.test("saveAccountIf: schreibt nur bei passendem Refresh-Token/Umgebung, sonst false ohne Änderung", async () => {
  const st = fakeStore({});
  const ok1 = await st.store.saveAccountIf({ refresh_token: "RT", environment: "sandbox" }, { access_token: "NEU" });
  assertEquals([ok1, st.state.account.access_token], [true, "NEU"]);
  const ok2 = await st.store.saveAccountIf({ refresh_token: "ALT", environment: "sandbox" }, { access_token: "SOLLTE-NICHT" });
  assertEquals([ok2, st.state.account.access_token], [false, "NEU"]);
  const ok3 = await st.store.saveAccountIf({ refresh_token: "RT", environment: "production" }, { access_token: "SOLLTE-NICHT" });
  assertEquals([ok3, st.state.account.access_token], [false, "NEU"]);
});

Deno.test("Sperre nicht zu bekommen (Store-Fehler) -> {ok:false,error}, keine Tokens im Fehlertext, kein Absturz", async () => {
  const boom = () => Promise.reject(new Error("sollte nicht aufgerufen werden"));
  const store: Store = {
    photoBase: "https://proj.supabase.co",
    account: boom, saveAccount: boom, unlock: boom,
    tryLock: () => Promise.reject(new Error("DB nicht erreichbar")),
    consumeState: () => Promise.resolve(false),
    openRows: () => Promise.resolve([]),
    soll: () => Promise.resolve({ listings: [], items: [], liveCopyIds: new Set(), photos: [] }),
    saveRow: () => Promise.resolve(),
    liveOfferCount: () => Promise.resolve(0),
    saveAccountIf: () => Promise.resolve(true),
  };
  const eb = fakeEbay();
  const r = await runSync({ store, fetch: eb.fetchFn, env: (k) => ENV[k], now: () => NOW, holder: "t" });
  assertEquals(r, { ok: false, error: "DB nicht erreichbar" });
});

Deno.test("Abbruch mitten im Einstellen -> Folgelauf verwendet die vorhandene Offer statt einer zweiten", async () => {
  const st = fakeStore({ listings: [L("l1")], items: [I("l1", "c1"), I("l1", "c2")], live: ["c1", "c2"] });
  const opts: FakeEbayOpts = { aspects: ASPECTS, publishDown: true };
  const eb = fakeEbay(opts);
  const deps = { store: st.store, fetch: eb.fetchFn, env: (k: string) => ENV[k], now: () => NOW, holder: "t" };
  const r1 = await runSync(deps);
  assertEquals(r1.ok, false);
  assertEquals(eb.offers.size, 1);
  assertEquals(st.state.rows.has("l1"), false);
  opts.publishDown = false;
  const r2 = await runSync(deps);
  assertEquals(r2.ok && !r2.busy && r2.summary.published, 1);
  assertEquals(eb.offers.size, 1, "keine zweite Offer angelegt");
  assertEquals(st.state.rows.get("l1")!.state, "online");
});

// -- Fixrunde 2 (Task 5) ----------------------------------------------------------------------------------------

Deno.test("saveAccountIf liefert false beim Token-Patch -> Lauf bricht sofort ab, keine eBay-Aufrufe, nichts geschrieben", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) });
  const store: Store = { ...w.store, saveAccountIf: () => Promise.resolve(false) };
  const r = await runSync({ store, fetch: w.eb.fetchFn, env: (k) => ENV[k], now: () => NOW, holder: "t" });
  assertEquals(r.ok && !r.busy && [r.summary.published, r.text], [0, "0 eingestellt · 0 geändert · 0 beendet · 0 Fehler"]);
  assertEquals(w.eb.ebayCalls().length, 0, "kein Inventar-/Offer-Aufruf danach");
  assertEquals(w.state.rows.size, 0, "keine Zeile geschrieben");
  assertEquals(w.state.account.last_error, null, "last_error unverändert -- nicht mit stale Werten überschrieben");
});

Deno.test("saveAccountIf liefert false beim Trennen (Zeile inzwischen anders, z.B. frischer Rücksprung) -> kein EXPIRED, sauberer Abbruch", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { refreshInvalid: true });
  const store: Store = { ...w.store, saveAccountIf: () => Promise.resolve(false) };
  const r = await runSync({ store, fetch: w.eb.fetchFn, env: (k) => ENV[k], now: () => NOW, holder: "t" });
  assertEquals(r.ok && !r.busy && r.summary.published, 0);
  assertEquals(w.state.account.last_error, null, "kein EXPIRED gesetzt -- die Zeile war schon anders");
  assertEquals(w.state.account.refresh_token, "RT", "Tokens nicht angefasst");
  assertEquals(w.state.rows.size, 0);
});

Deno.test("Laufabbruch ohne Verbindung überschreibt einen stehenden EXPIRED-Hinweis nicht mit einer unabhängigen Fehlermeldung", async () => {
  const w = world({ account: account({ refresh_token: null, last_error: EXPIRED }) });
  const store: Store = { ...w.store, openRows: () => Promise.reject(new Error("DB weg")) };
  const r = await runSync({ store, fetch: w.eb.fetchFn, env: (k) => ENV[k], now: () => NOW, holder: "t" });
  assertEquals(r, { ok: false, error: "DB weg" });
  assertEquals(w.state.account.last_error, EXPIRED, "steht weiterhin, nicht durch 'DB weg' ersetzt");
  assertEquals(w.state.account.last_run_at, "2026-09-22T12:00:00.000Z", "Laufzeitpunkt trotzdem vermerkt");
});

Deno.test("Laufabbruch, während verbunden -> last_error wird wie bisher gesetzt (keine Regression zu Minor 3)", async () => {
  const w = world({ account: account({ last_error: EXPIRED }) });
  const store: Store = { ...w.store, openRows: () => Promise.reject(new Error("DB weg")) };
  const r = await runSync({ store, fetch: w.eb.fetchFn, env: (k) => ENV[k], now: () => NOW, holder: "t" });
  assertEquals(r, { ok: false, error: "DB weg" });
  assertEquals(w.state.account.last_error, "DB weg", "verbunden -> der neue Fehler ersetzt den alten Hinweis");
});
