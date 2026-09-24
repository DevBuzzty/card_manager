// supabase/functions/ebay-sync/orders.ts
// Spec H3b §7/§8 -- Schritt 2 (Bestellungen abholen und buchen) und Schritt 3 (Gebühren nachtragen) des Abgleichers.
// Die Regeln stehen rein in _shared/ebay-orders.ts und _shared/listing-text.ts; hier nur Ablauf und Ein-/Ausgabe.
// Fehler: vorübergehend/Verbindung (EbayError transient/auth) und Datenbankfehler brechen den Durchgang ab -- der Cursor
// rückt dann nicht über die unbearbeitete Bestellung hinaus. Eine fachliche Ablehnung von book_sale betrifft nur ihre
// Bestellung (Status `fehler` + Hinweis, kein neuer Versuch).
import type { EbayApi } from "../_shared/ebay-client.ts";
import {
  bookingFor, type EbayOrder, feesPatch, feeUpdate, finalFeeCents, type Notice, notices, parseOrder, type ParsedOrder, pickCopies,
} from "../_shared/ebay-orders.ts";
import { afterListingSale, cleanupAfterSale } from "../_shared/listing-text.ts";
import { toCents } from "../_shared/sales-math.ts";
import { type Account, BookRejected, type OrderRow, type Store } from "../_shared/ebay-store.ts";
import type { Summary } from "../_shared/ebay-plan.ts";

// A4: jeder Lauf fragt ab Cursor minus 10 Minuten (spät geschriebene Änderungen); ebay_orders verhindert Doppelbuchungen.
export const ORDERS_OVERLAP_MS = 10 * 60 * 1000;
export const FEES_PER_RUN = 20;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function ordersSince(acc: Pick<Account, "orders_cursor" | "connected_at">, now: Date): string {
  if (acc.orders_cursor) return new Date(Date.parse(acc.orders_cursor) - ORDERS_OVERLAP_MS).toISOString();
  // Erster Lauf: ab dem Verbinden (A4) -- ältere Bestellungen werden nie gebucht.
  return new Date(acc.connected_at ? Date.parse(acc.connected_at) : now.getTime()).toISOString();
}

type Ctx = { api: EbayApi; store: Store; env: string; s: Summary };

function orderRow(p: ParsedOrder, env: string, patch: Partial<OrderRow>): OrderRow {
  return {
    order_id: p.orderId, environment: env, sale_id: null, status: "fehler", fees_provisional: null, fees_final: false,
    raw_total: p.grossCents / 100, error: null, ...patch,
  };
}

async function bookNew(c: Ctx, p: ParsedOrder) {
  const listingIds = [...new Set(p.lines.map((l) => l.listingId).filter((x): x is string => x != null))].sort(cmp);
  const world = await c.store.saleWorld(listingIds);
  const liveByListing: Record<string, string[]> = {};
  for (const id of listingIds) {
    liveByListing[id] = world.items.filter((it) => it.listing_id === id && world.live.has(it.copy_id)).map((it) => it.copy_id);
  }
  // Wiederanlauf: ist der Verkauf schon gebucht (Abbruch nach book_sale, vor saveOrder), gelten SEINE Exemplare --
  // neu wählen würde andere (oder keine) lebenden Karten treffen. Aufräumen und Hinweise sind wiederholbar.
  const existing = await c.store.saleForUpdate(p.saleId);
  const ordered = p.lines.reduce((a, l) => a + (l.listingId ? l.quantity : 0), 0);
  const pick = existing
    ? { copyIds: existing.items.map((i) => i.copy_id).sort(cmp), missing: Math.max(0, ordered - existing.items.length) }
    : pickCopies(p, liveByListing);
  const soldPerListing = new Map<string, number>();
  for (const l of p.lines) if (l.listingId) soldPerListing.set(l.listingId, (soldPerListing.get(l.listingId) ?? 0) + l.quantity);
  // eBay zählt die Menge als verkauft, egal was wir buchen konnten -- sonst meldet Schritt 4 „Auf eBay verkauft …“.
  const bump = async () => { for (const [id, q] of soldPerListing) await c.store.bumpSoldSeen(id, q); };

  if (pick.copyIds.length === 0) {
    await c.store.addNotices([notices.noCard(p.saleId, p.orderId)]);
    await bump();
    await c.store.saveOrder(orderRow(p, c.env, { status: "fehler", error: "keine lebende Karte" }));
    c.s.errors++;
    return;
  }
  const channel = await c.store.ebayChannel();
  const cards = await c.store.cardsFor(pick.copyIds);
  const b = bookingFor(p, pick.copyIds, cards, channel.fee_percent, channel.name);
  const feesCents = existing ? toCents(existing.head.fees) : b.feesCents;
  try {
    if (!existing) await c.store.bookSale(b.p_sale, b.p_items);
  } catch (e) {
    if (!(e instanceof BookRejected)) throw e;
    await c.store.addNotices([notices.bookError(p.saleId, p.orderId, e.message)]);
    await bump();
    await c.store.saveOrder(orderRow(p, c.env, { status: "fehler", error: e.message }));
    c.s.errors++;
    return;
  }
  // Das Angebot, aus dem verkauft wurde: ganz/teilweise verkauft (A6: eBay-Rest = Stückpreis x Restmenge).
  const sold = new Set(pick.copyIds);
  for (const id of listingIds) {
    const l = world.listings.find((x) => x.listing_id === id);
    if (!l || l.status !== "aktiv") continue;
    const live = world.items.filter((it) => it.listing_id === id && (world.live.has(it.copy_id) || sold.has(it.copy_id))).map((it) => it.copy_id);
    await c.store.applyListingSale(id, p.saleId, afterListingSale(l, live, pick.copyIds));
  }
  // Andere Angebote aufräumen; eine Erinnerung nur für Kanäle außer eBay (eBay-Angebote gleicht Schritt 4 selbst ab).
  const others = world.listings.filter((l) => !listingIds.includes(l.listing_id));
  const cl = cleanupAfterSale(others, world.items, pick.copyIds, null);
  await c.store.cleanupListings(cl);
  const out: Notice[] = [notices.shipping(p.saleId, p.orderId)];
  if (pick.missing > 0) out.push(notices.missing(p.saleId, p.orderId, pick.missing));
  if (p.kind === "gemischt") out.push(notices.mixed(p.saleId, p.orderId));
  if (p.refunded) out.push(notices.refunded(p.saleId, p.orderId));
  for (const r of cl.remind) {
    const l = others.find((x) => x.listing_id === r.listing_id);
    if (l && l.channel_id !== "ebay") out.push(notices.remind(p.saleId, r));
  }
  await c.store.addNotices(out);
  await bump();
  await c.store.saveOrder(orderRow(p, c.env, { status: "gebucht", sale_id: p.saleId, fees_provisional: feesCents == null ? null : feesCents / 100 }));
  c.s.booked++;
}

async function handle(c: Ctx, o: EbayOrder, known: OrderRow | undefined) {
  const p = parseOrder(o, c.env);
  if (known) {
    // §7.4 Käufer-Storno nach der Buchung: H2-Storno, Karten zurück, Hinweis (nicht still neu einstellen).
    if (known.status === "gebucht" && p.cancelled) {
      await c.store.cancelSale(known.sale_id ?? p.saleId);
      const first = p.lines.find((l) => l.listingId)?.listingId ?? null;
      await c.store.addNotices([notices.cancelled(p.saleId, p.orderId, first)]);
      await c.store.saveOrder({ ...known, status: "storniert" });
      c.s.cancelled++;
    } else if (known.status === "gebucht" && p.refunded) {
      await c.store.addNotices([notices.refunded(p.saleId, p.orderId)]);
    }
    return;
  }
  if (p.kind === "fremd") return await c.store.saveOrder(orderRow(p, c.env, { status: "fremd" }));
  // Vor der Buchung storniert: nur festhalten.
  if (p.cancelled) return await c.store.saveOrder(orderRow(p, c.env, { status: "storniert" }));
  await bookNew(c, p);
}

// Schritt 2. Gibt zurück, ob alle abgeholten Bestellungen bearbeitet wurden (sonst Zeitbudget erschöpft).
export async function runOrders(
  api: EbayApi, store: Store, env: string, acc: Account, now: Date, deadline: () => boolean, s: Summary,
): Promise<boolean> {
  const list = (await api.getOrders(ordersSince(acc, now)))
    .sort((a, b) => cmp(a.lastModifiedDate, b.lastModifiedDate) || cmp(a.orderId, b.orderId));
  if (list.length === 0) return true;
  const known = new Map((await store.orders(list.map((o) => o.orderId))).map((o) => [o.order_id, o]));
  const c: Ctx = { api, store, env, s };
  let cursor: string | null = null;
  let done = true;
  for (const o of list) {
    if (deadline()) { done = false; break; }
    await handle(c, o, known.get(o.orderId));
    cursor = o.lastModifiedDate;
  }
  if (cursor && (!acc.orders_cursor || cursor > acc.orders_cursor)) await store.saveAccount({ orders_cursor: cursor });
  return done;
}

// Schritt 3 (§7.3 + A2): echte Gebühren aus den Finanzdaten; höchstens FEES_PER_RUN Bestellungen je Durchgang.
export async function runFees(api: EbayApi, store: Store, env: string, deadline: () => boolean, s: Summary) {
  for (const o of await store.openFeeOrders(env, FEES_PER_RUN)) {
    if (deadline()) return;
    const sale = o.sale_id ? await store.saleForUpdate(o.sale_id) : null;
    if (!sale || sale.head.status !== "aktiv") {
      await store.saveOrder({ ...o, fees_final: true });
      continue;
    }
    const final = finalFeeCents(await api.saleTransactions(o.order_id));
    const d = feeUpdate({ saleFeesCents: toCents(sale.head.fees), provisionalCents: toCents(o.fees_provisional), finalCents: final });
    if (d === "wait") continue;
    if (d === "update") {
      const patch = feesPatch(sale, final!);
      await store.updateSale(patch.p_sale, patch.p_shares);
    }
    await store.saveOrder({ ...o, fees_final: true });
    s.feesFinal++;
  }
}
