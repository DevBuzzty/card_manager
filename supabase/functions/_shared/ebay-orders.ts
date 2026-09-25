// supabase/functions/_shared/ebay-orders.ts
// Spec H3b §7 (H3b2) -- reine Regeln: eBay-Bestellung (Sell Fulfillment API) -> H2-Buchung, Gebühren-Regel, Hinweise.
// Keine Aufrufe. Tests: ebay-orders_test.ts gegen docs/fixtures/ebay/orders.json.
// Geld in ganzen Cent; nur p_sale/p_items tragen Euro (wie book_sale sie erwartet, siehe SalesRepository.kt#book).
import { distribute, feeDefaultCents, marketValueCents, type PriceCard, type PriceCopy, toCents } from "./sales-math.ts";

export type Amount = { value?: string | null; currency?: string | null } | null | undefined;
export type EbayLineItem = {
  lineItemId: string; sku?: string | null; quantity?: number | null; lineItemCost?: Amount;
  deliveryCost?: { shippingCost?: Amount } | null;
};
export type EbayOrder = {
  orderId: string; creationDate: string; lastModifiedDate: string; orderPaymentStatus?: string | null;
  cancelStatus?: { cancelState?: string | null } | null;
  pricingSummary?: { priceSubtotal?: Amount; deliveryCost?: Amount; total?: Amount } | null;
  totalMarketplaceFee?: Amount; lineItems?: EbayLineItem[] | null;
};
export type Line = { lineItemId: string; listingId: string | null; quantity: number; itemCents: number; shippingCents: number };
export type OrderKind = "app" | "fremd" | "gemischt";
export type ParsedOrder = {
  orderId: string; saleId: string; soldOn: string; kind: OrderKind; lines: Line[];
  grossCents: number; feeCents: number | null; cancelled: boolean; refunded: boolean;
};
export type Notice = { notice_id: string; kind: "reminder" | "shipping" | "error" | "token"; text: string; sale_id: string | null; listing_id: string | null };

// SKU der App-Angebote (H3b1 §5.2): `L-<listing_id>`.
const SKU = /^L-(.+)$/;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function amountCents(a: Amount): number | null {
  if (!a || a.value == null || a.value === "") return null;
  const n = Number(a.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Kalenderdatum in Europe/Berlin (Spec §7.2 „Datum = Bestelldatum in Europe/Berlin“).
export function berlinDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

export const saleIdFor = (env: string, orderId: string) => `ebay-${env}-${orderId}`;

export function parseOrder(o: EbayOrder, env: string): ParsedOrder {
  const lines: Line[] = (o.lineItems ?? []).map((li) => ({
    lineItemId: String(li.lineItemId),
    listingId: SKU.exec(li.sku ?? "")?.[1] ?? null,
    quantity: Math.max(1, Number(li.quantity) || 1),
    itemCents: amountCents(li.lineItemCost) ?? 0,
    shippingCents: amountCents(li.deliveryCost?.shippingCost) ?? 0,
  }));
  const app = lines.filter((l) => l.listingId != null);
  const kind: OrderKind = app.length === 0 ? "fremd" : app.length === lines.length ? "app" : "gemischt";
  const fee = amountCents(o.totalMarketplaceFee);
  let grossCents: number;
  let feeCents: number | null;
  if (kind === "gemischt") {
    // Nur die App-Positionen zählen (A3); die Gebühr anteilig nach Artikelpreis.
    grossCents = app.reduce((a, l) => a + l.itemCents + l.shippingCents, 0);
    const all = lines.reduce((a, l) => a + l.itemCents, 0);
    const mine = app.reduce((a, l) => a + l.itemCents, 0);
    feeCents = fee == null ? null : all > 0 ? Math.round(fee * mine / all) : 0;
  } else {
    // Spec §7.2: Preis = Artikelpreis + vom Käufer bezahlter Versand.
    const subtotal = amountCents(o.pricingSummary?.priceSubtotal) ?? lines.reduce((a, l) => a + l.itemCents, 0);
    grossCents = subtotal + (amountCents(o.pricingSummary?.deliveryCost) ?? 0);
    feeCents = fee;
  }
  const pay = o.orderPaymentStatus ?? "";
  return {
    orderId: o.orderId, saleId: saleIdFor(env, o.orderId), soldOn: berlinDate(o.creationDate), kind, lines, grossCents, feeCents,
    cancelled: o.cancelStatus?.cancelState === "CANCELED",
    refunded: pay === "FULLY_REFUNDED" || pay === "PARTIALLY_REFUNDED",
  };
}

// Spec §7.2: je Position die ersten q lebenden Positionen des Angebots, sortiert nach copy_id; ein Exemplar nur einmal.
// `missing` = Exemplare, die fehlen (§7.5: inzwischen anderswo verkauft).
export function pickCopies(p: ParsedOrder, liveByListing: Record<string, string[]>) {
  const taken = new Set<string>();
  const byListing: Record<string, string[]> = {};
  let missing = 0;
  for (const l of p.lines) {
    if (l.listingId == null) continue;
    const free = [...(liveByListing[l.listingId] ?? [])].sort(cmp).filter((id) => !taken.has(id));
    const got = free.slice(0, l.quantity);
    for (const id of got) taken.add(id);
    byListing[l.listingId] = [...(byListing[l.listingId] ?? []), ...got];
    missing += l.quantity - got.length;
  }
  return { copyIds: [...taken].sort(cmp), byListing, missing };
}

export type CardForCopy = { card: PriceCard | null; copy: PriceCopy | null };

// p_sale/p_items für book_sale. Gebühr: aus der Bestellung (A1), sonst Prozentsatz des Kanals. Versand leer (§7.2).
export function bookingFor(
  p: ParsedOrder, copyIds: string[], cards: Record<string, CardForCopy>, feePercent: number | string | null, channelName = "eBay",
) {
  const ids = [...copyIds].sort(cmp);
  const feesCents = p.feeCents ?? feeDefaultCents(p.grossCents, feePercent);
  const values = ids.map((id) => marketValueCents(cards[id]?.card ?? null, cards[id]?.copy ?? null));
  const shares = distribute(p.grossCents - feesCents, values);
  return {
    p_sale: {
      sale_id: p.saleId, sold_on: p.soldOn, channel_id: "ebay", channel_name: channelName,
      gross: p.grossCents / 100, fees: feesCents / 100, shipping: null, note: `eBay-Bestellung ${p.orderId}`,
    },
    p_items: ids.map((id, i) => ({ copy_id: id, value_at_sale: values[i] / 100, share: shares[i] / 100 })),
    feesCents,
  };
}

// Spec §7.3 + A2: echte Gebühren nur nachtragen, solange der Verkauf noch die vorläufige trägt.
export function feeUpdate(x: { saleFeesCents: number | null; provisionalCents: number | null; finalCents: number | null }): "wait" | "update" | "keep" {
  if (x.finalCents == null) return "wait";
  return x.saleFeesCents === x.provisionalCents ? "update" : "keep";
}

export type SaleHead = {
  sale_id: string; sold_on: string; channel_id: string; channel_name: string; gross: number | string;
  fees: number | string | null; shipping: number | string | null; note: string | null; status: string;
};
export type SaleForUpdate = { head: SaleHead; items: { copy_id: string; value_at_sale: number | string }[] };

// update_sale-Aufruf für die endgültige Gebühr: Kopf unverändert bis auf fees, Anteile neu verteilt (Netto ändert sich),
// eingefrorener Marktwert (value_at_sale) als Gewicht -- wie SaleDialog/updateSale am PC.
export function feesPatch(sale: SaleForUpdate, finalCents: number) {
  const h = sale.head;
  const items = [...sale.items].sort((a, b) => cmp(a.copy_id, b.copy_id));
  const net = (toCents(h.gross) ?? 0) - finalCents - (toCents(h.shipping) ?? 0);
  const shares = distribute(net, items.map((it) => toCents(it.value_at_sale) ?? 0));
  return {
    p_sale: {
      sale_id: h.sale_id, sold_on: h.sold_on, channel_id: h.channel_id, channel_name: h.channel_name, gross: Number(h.gross),
      fees: finalCents / 100, shipping: h.shipping == null ? null : Number(h.shipping), note: h.note,
    },
    p_shares: items.map((it, i) => ({ copy_id: it.copy_id, share: shares[i] / 100 })),
  };
}

// Summe der Verkaufsgebühren aller SALE-Transaktionen der Bestellung (Finances API); keine -> noch nicht da.
export function finalFeeCents(transactions: { transactionType?: string | null; totalFeeAmount?: Amount }[]): number | null {
  const sales = transactions.filter((t) => t.transactionType === "SALE");
  if (sales.length === 0) return null;
  return sales.reduce((a, t) => a + (amountCents(t.totalFeeAmount) ?? 0), 0);
}

// Spec §4.3: 30 Tage vor Ablauf des Refresh-Tokens ein Hinweis.
export const TOKEN_WARN_MS = 30 * 24 * 60 * 60 * 1000;
export function tokenDue(expiresIso: string | null, nowMs: number): boolean {
  if (!expiresIso) return false;
  const t = Date.parse(expiresIso);
  return Number.isFinite(t) && t - nowMs <= TOKEN_WARN_MS;
}

const deDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}.${m}.${y}`; };

// Hinweise (Spec §7.6) mit festen Schlüsseln: derselbe Anlass erzeugt nie zwei Zeilen.
export const notices = {
  shipping: (saleId: string, orderId: string): Notice =>
    ({ notice_id: `ship-${saleId}`, kind: "shipping", text: `Versandkosten für eBay-Bestellung ${orderId} nachtragen`, sale_id: saleId, listing_id: null }),
  missing: (saleId: string, orderId: string, n: number): Notice => ({
    notice_id: `missing-${saleId}`, kind: "error", sale_id: saleId, listing_id: null,
    text: `eBay-Bestellung ${orderId}: ${n} ${n === 1 ? "Karte" : "Karten"} schon anderswo verkauft – bitte prüfen`,
  }),
  noCard: (saleId: string, orderId: string): Notice => ({
    notice_id: `nocard-${saleId}`, kind: "error", sale_id: null, listing_id: null,
    text: `eBay-Bestellung ${orderId} ohne lebende Karte – nicht gebucht, bitte prüfen`,
  }),
  cancelled: (saleId: string, orderId: string, listingId: string | null): Notice => ({
    notice_id: `cancel-${saleId}`, kind: "reminder", sale_id: saleId, listing_id: listingId,
    text: `eBay-Bestellung ${orderId} storniert – die Karten sind zurück. Angebot erneut anbieten?`,
  }),
  refunded: (saleId: string, orderId: string): Notice => ({
    notice_id: `refund-${saleId}`, kind: "reminder", sale_id: saleId, listing_id: null,
    text: `eBay meldet eine Erstattung zu Bestellung ${orderId} – bitte prüfen`,
  }),
  mixed: (saleId: string, orderId: string): Notice => ({
    notice_id: `mixed-${saleId}`, kind: "reminder", sale_id: saleId, listing_id: null,
    text: `eBay-Bestellung ${orderId} enthält Artikel ohne App-Angebot – nur die App-Karten sind gebucht`,
  }),
  // Wortlaut wie der Buchen-Dialog am PC („Auch dort herausnehmen: <Kanal> – <Titel>“, SaleDialog.jsx).
  remind: (saleId: string, r: { listing_id: string; channel_name?: string | null; title: string }): Notice => ({
    notice_id: `remind-${saleId}-${r.listing_id}`, kind: "reminder", sale_id: saleId, listing_id: r.listing_id,
    text: `eBay-Verkauf: auch dort herausnehmen – ${r.channel_name ?? "Angebot"} – ${r.title}`,
  }),
  bookError: (saleId: string, orderId: string, message: string): Notice => ({
    notice_id: `error-${saleId}`, kind: "error", sale_id: null, listing_id: null,
    text: `eBay-Bestellung ${orderId} nicht gebucht: ${message}`,
  }),
  token: (expiresIso: string): Notice => ({
    notice_id: `token-${expiresIso.slice(0, 10)}`, kind: "token", sale_id: null, listing_id: null,
    text: `eBay-Verbindung läuft am ${deDate(expiresIso)} ab – bitte in den Einstellungen neu verbinden`,
  }),
};
