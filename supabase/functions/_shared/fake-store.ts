// supabase/functions/_shared/fake-store.ts -- NUR für Tests: Store im Speicher, Sperre wie ebay_try_lock.
// H3b2: dazu Bestellungen, Verkäufe (book_sale/cancel_sale/update_sale nachgebaut), Angebots-Aufräumen und Hinweise.
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { CardForCopy, Notice } from "./ebay-orders.ts";
import type { EbayRow } from "./ebay-plan.ts";
import { type Account, BookRejected, type OrderRow, type Store } from "./ebay-store.ts";

export function account(patch: Partial<Account> = {}): Account {
  return {
    environment: "sandbox", marketplace: "EBAY_DE", refresh_token: "RT", refresh_expires_at: "2028-01-01T00:00:00Z",
    access_token: "AT", access_expires_at: "2026-09-22T14:00:00Z", oauth_state: null, oauth_state_expires_at: null,
    payment_policy_id: "PAY1", payment_policy_name: "Zahlung", fulfillment_policy_id: "FUL1", fulfillment_policy_name: "Versand",
    return_policy_id: "RET1", return_policy_name: "Keine Rücknahme", location_key: "ygo-default",
    last_run_at: null, last_run_summary: null, last_error: null, connected_at: "2026-09-01T00:00:00Z", orders_cursor: null, ...patch,
  };
}

export type FakeListing = SollListing & { channel_name?: string; external_url?: string | null; sale_id?: string | null };
export type FakeSale = {
  head: { sale_id: string; sold_on: string; channel_id: string; channel_name: string; gross: number; fees: number | null; shipping: number | null; note: string | null; status: string };
  items: { copy_id: string; value_at_sale: number; share: number }[];
};

export function fakeStore(init: {
  account?: Account; listings?: FakeListing[]; items?: SollItem[]; live?: string[]; photos?: Photo[]; rows?: EbayRow[];
  cards?: Record<string, CardForCopy>; feePercent?: number | null; orders?: OrderRow[];
}) {
  const state = {
    account: init.account ?? account(),
    listings: init.listings ?? [], items: init.items ?? [], live: new Set(init.live ?? []), photos: init.photos ?? [],
    rows: new Map((init.rows ?? []).map((r) => [r.listing_id, r])),
    lockHolder: null as string | null, unlocked: 0,
    cards: init.cards ?? {} as Record<string, CardForCopy>, feePercent: init.feePercent ?? 0,
    orders: new Map((init.orders ?? []).map((o) => [o.order_id, o])),
    sales: new Map<string, FakeSale>(), notices: new Map<string, Notice>(),
    // Tests: saveOrder scheitert n-mal (Abbruch zwischen Buchung und Merken der Bestellung).
    failSaveOrder: 0,
  };
  const listing = (id: string) => state.listings.find((l) => l.listing_id === id);
  const store: Store = {
    photoBase: "https://proj.supabase.co",
    account: () => Promise.resolve({ ...state.account }),
    saveAccount: (p) => { state.account = { ...state.account, ...p }; return Promise.resolve(); },
    saveAccountIf: (expect, p) => {
      const a = state.account;
      if (a.environment !== expect.environment || a.refresh_token !== expect.refresh_token) return Promise.resolve(false);
      state.account = { ...a, ...p };
      return Promise.resolve(true);
    },
    tryLock: (h) => { if (state.lockHolder) return Promise.resolve(false); state.lockHolder = h; return Promise.resolve(true); },
    unlock: (h) => { if (state.lockHolder === h) state.lockHolder = null; state.unlocked++; return Promise.resolve(); },
    consumeState: (s) => {
      const a = state.account;
      const ok = a.oauth_state === s && !!a.oauth_state_expires_at && Date.parse(a.oauth_state_expires_at) > Date.now();
      if (ok) state.account = { ...a, oauth_state: null, oauth_state_expires_at: null };
      return Promise.resolve(ok);
    },
    openRows: (extra) => Promise.resolve([...state.rows.values()].filter((r) => r.state !== "beendet" || r.listing_id === extra)),
    soll: (ids) => Promise.resolve({
      listings: state.listings.filter((l) => (l.channel_id === "ebay" && l.status === "aktiv" && !l.deleted) || ids.includes(l.listing_id)),
      items: state.items.filter((i) => !i.deleted), liveCopyIds: state.live, photos: state.photos.filter((p) => !p.deleted),
    }),
    saveRow: (r) => { state.rows.set(r.listing_id, { ...r }); return Promise.resolve(); },
    liveOfferCount: (env) => Promise.resolve([...state.rows.values()]
      .filter((r) => r.environment === env && (r.state === "online" || r.state === "fehler") && r.offer_id).length),
    // --- H3b2 ---
    orders: (ids) => Promise.resolve(ids.map((id) => state.orders.get(id)).filter((o): o is OrderRow => !!o).map((o) => ({ ...o }))),
    saveOrder: (o) => {
      if (state.failSaveOrder > 0) { state.failSaveOrder--; return Promise.reject(new Error("ebay_orders speichern: Datenbank weg")); }
      state.orders.set(o.order_id, { ...o });
      return Promise.resolve();
    },
    openFeeOrders: (env, limit) => Promise.resolve([...state.orders.values()]
      .filter((o) => o.environment === env && o.status === "gebucht" && !o.fees_final).slice(0, limit).map((o) => ({ ...o }))),
    saleWorld: (ids) => {
      const listings = state.listings.filter((l) => !l.deleted && (l.status === "aktiv" || ids.includes(l.listing_id)))
        .map((l) => ({ ...l, channel_name: l.channel_name ?? (l.channel_id === "ebay" ? "eBay" : l.channel_id), external_url: l.external_url ?? null }));
      const have = new Set(listings.map((l) => l.listing_id));
      return Promise.resolve({ listings, items: state.items.filter((i) => !i.deleted && have.has(i.listing_id)).map((i) => ({ ...i })), live: new Set(state.live) });
    },
    cardsFor: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, state.cards[id] ?? { card: { price: 2 }, copy: { edition: "unlimited", condition: "NM" } }]))),
    ebayChannel: () => Promise.resolve({ name: "eBay", fee_percent: state.feePercent }),
    bookSale: (sale, items) => {
      const s = sale as FakeSale["head"];
      if (state.sales.has(s.sale_id)) return Promise.resolve("exists" as const);
      const its = items as FakeSale["items"];
      for (const it of its) if (!state.live.has(it.copy_id)) return Promise.reject(new BookRejected(`Karte bereits verkauft oder gelöscht (${it.copy_id}).`));
      for (const it of its) state.live.delete(it.copy_id);
      state.sales.set(s.sale_id, { head: { ...s, status: "aktiv" }, items: its.map((i) => ({ ...i })) });
      return Promise.resolve("ok" as const);
    },
    cancelSale: (id) => {
      const s = state.sales.get(id);
      if (s && s.head.status === "aktiv") { s.head.status = "storniert"; for (const it of s.items) state.live.add(it.copy_id); }
      return Promise.resolve();
    },
    saleForUpdate: (id) => {
      const s = state.sales.get(id);
      return Promise.resolve(s ? { head: { ...s.head }, items: s.items.map((i) => ({ copy_id: i.copy_id, value_at_sale: i.value_at_sale })) } : null);
    },
    updateSale: (sale, shares) => {
      const p = sale as FakeSale["head"];
      const s = state.sales.get(p.sale_id)!;
      s.head = { ...s.head, ...p };
      for (const x of shares as { copy_id: string; share: number }[]) s.items.find((i) => i.copy_id === x.copy_id)!.share = x.share;
      return Promise.resolve();
    },
    applyListingSale: (id, saleId, r) => {
      const l = listing(id);
      if (!l) return Promise.resolve();
      if (r.status === "verkauft") { if (l.status === "aktiv") { l.status = "verkauft"; l.sale_id = saleId; } return Promise.resolve(); }
      for (const c of r.removeCopyIds) { const it = state.items.find((i) => i.listing_id === id && i.copy_id === c); if (it) it.deleted = true; }
      if (r.priceCents != null) l.price = (r.priceCents / 100).toFixed(2);
      return Promise.resolve();
    },
    cleanupListings: (c) => {
      for (const x of c.removeItems) { const it = state.items.find((i) => i.listing_id === x.listing_id && i.copy_id === x.copy_id); if (it) it.deleted = true; }
      for (const id of c.endListings) { const l = listing(id); if (l && l.status === "aktiv") l.status = "beendet"; }
      return Promise.resolve();
    },
    addNotices: (ns) => { for (const n of ns) if (!state.notices.has(n.notice_id)) state.notices.set(n.notice_id, { ...n }); return Promise.resolve(); },
    bumpSoldSeen: (id, qty) => {
      const r = state.rows.get(id);
      if (r) r.sold_seen = (r.sold_seen ?? 0) + qty;
      return Promise.resolve();
    },
  };
  return { store, state };
}
