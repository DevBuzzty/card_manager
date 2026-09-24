// supabase/functions/_shared/ebay-store.ts
// Spec H3b §4.2/§5.1/§8 -- Datenbankzugriff der eBay-Funktionen hinter einer schmalen Schnittstelle (Tests: fake-store.ts).
// Die echte Fassung nutzt die Dienstrolle (SUPABASE_SERVICE_ROLE_KEY): nur sie liest/schreibt ebay_account/ebay_listings.
// PostgREST kappt Antworten bei 1000 Zeilen -> jede wachsende Abfrage blättert über eine stabile Ordnung.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { EbayRow } from "./ebay-plan.ts";
import type { CardForCopy, Notice, SaleForUpdate } from "./ebay-orders.ts";
import type { AfterSale, ListingHead, ListingItemRow } from "./listing-text.ts";

export type Account = {
  environment: string; marketplace: string;
  refresh_token: string | null; refresh_expires_at: string | null; access_token: string | null; access_expires_at: string | null;
  oauth_state: string | null; oauth_state_expires_at: string | null;
  payment_policy_id: string | null; payment_policy_name: string | null;
  fulfillment_policy_id: string | null; fulfillment_policy_name: string | null;
  return_policy_id: string | null; return_policy_name: string | null;
  location_key: string | null; last_run_at: string | null; last_run_summary: string | null; last_error: string | null;
  connected_at: string | null; orders_cursor?: string | null;
};
export type SollData = { listings: SollListing[]; items: SollItem[]; liveCopyIds: Set<string>; photos: Photo[] };

// H3b2 §7.1: eine abgeholte eBay-Bestellung (nur die Funktion schreibt).
export type OrderRow = {
  order_id: string; environment: string; sale_id: string | null; status: "gebucht" | "storniert" | "fehler" | "fremd";
  fees_provisional: number | null; fees_final: boolean; raw_total: number | null; error: string | null;
};
// H3b2 §7.2: alles, was Buchen und Aufräumen brauchen -- alle aktiven Angebote (jeder Kanal) plus die angefragten
// (gleich welchen Zustands), ihre lebenden Positionen und welche Exemplare noch leben (nicht gelöscht, nicht verkauft).
export type SaleWorld = { listings: ListingHead[]; items: ListingItemRow[]; live: Set<string> };
// book_sale lehnt fachlich ab (Karte verkauft/gelöscht, keine Karte): Einzelfehler dieser Bestellung, kein Abbruch.
export class BookRejected extends Error {}

export interface Store {
  photoBase: string;
  account(): Promise<Account>;
  saveAccount(patch: Partial<Account>): Promise<void>;
  // Fixrunde 1 (Task 5) Minor 5: Token-Patch/-Löschung nur schreiben, wenn die Zeile seit dem Lesen nicht durch
  // set_environment/disconnect (ebay-auth) oder einen anderen Lauf verändert wurde -- sonst Wettlauf um Zeile 1.
  // -> true, wenn geschrieben wurde; false, wenn refresh_token/environment nicht mehr passten (dann nichts geändert).
  saveAccountIf(expect: { refresh_token: string | null; environment: string }, patch: Partial<Account>): Promise<boolean>;
  tryLock(holder: string, seconds: number): Promise<boolean>;
  unlock(holder: string): Promise<void>;
  // Fixrunde 1 Befund 2 (Task 4): Rücksprung-state atomar verbrauchen -- löscht ihn nur, wenn er noch zum
  // übergebenen Wert passt und nicht abgelaufen ist. Verhindert, dass zwei gleichzeitige Rücksprünge beide durchkommen.
  consumeState(state: string): Promise<boolean>;
  // ebay_listings mit state <> 'beendet', dazu die Zeile extraId (Erneut versuchen), falls vorhanden.
  openRows(extraId: string | null): Promise<EbayRow[]>;
  // Aktive eBay-Angebote und zusätzlich die Angebote ids (auch beendete/gelöschte), mit Positionen, lebenden Exemplaren, Fotos.
  soll(ids: string[]): Promise<SollData>;
  saveRow(row: EbayRow): Promise<void>;
  liveOfferCount(env: string): Promise<number>;
  // --- H3b2 (Schritte 2/3) ---
  orders(ids: string[]): Promise<OrderRow[]>;
  saveOrder(row: OrderRow): Promise<void>;
  openFeeOrders(env: string, limit: number): Promise<OrderRow[]>;
  saleWorld(listingIds: string[]): Promise<SaleWorld>;
  cardsFor(copyIds: string[]): Promise<Record<string, CardForCopy>>;
  ebayChannel(): Promise<{ name: string; fee_percent: number | null }>;
  // "exists" = derselbe sale_id ist schon gebucht (Wiederanlauf nach Abbruch); fachliche Ablehnung -> BookRejected.
  bookSale(sale: unknown, items: unknown[]): Promise<"ok" | "exists">;
  cancelSale(saleId: string): Promise<void>;
  saleForUpdate(saleId: string): Promise<SaleForUpdate | null>;
  updateSale(sale: unknown, shares: unknown[]): Promise<void>;
  applyListingSale(listingId: string, saleId: string, r: AfterSale): Promise<void>;
  cleanupListings(c: { removeItems: { listing_id: string; copy_id: string }[]; endListings: string[] }): Promise<void>;
  addNotices(n: Notice[]): Promise<void>;
  bumpSoldSeen(listingId: string, qty: number): Promise<void>;
}

const PAGE = 1000;
const CHUNK = 100;
const LISTING_COLS = "listing_id,channel_id,title,description,price,status,deleted";
const ITEM_COLS = "listing_id,copy_id,card_id,name,set_code,language,rarity,edition,condition,image_url,deleted";
const HEAD_COLS = "listing_id,channel_id,channel_name,title,price,status,deleted,external_url";
const WORLD_ITEM_COLS = "listing_id,copy_id,card_id,name,set_code,language,rarity,edition,condition,deleted";
const ORDER_COLS = "order_id,environment,sale_id,status,fees_provisional,fees_final,raw_total,error";
const ALREADY_BOOKED = "Verkauf bereits gebucht.";
const ROW_COLS = "listing_id,environment,state,sku,offer_id,item_id,item_url,published_qty,synced_hash,failed_hash,sold_seen,error,synced_at";

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
function fail(what: string, e: { message: string } | null): never {
  throw new Error(`${what}: ${e?.message ?? "unbekannt"}`);
}

export function supabaseStore(sb: SupabaseClient, supabaseUrl: string): Store {
  // Alle Seiten einer Abfrage; build(from, to) liefert die Abfrage mit .range(from, to) und fester Ordnung.
  async function all<T>(what: string, build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) fail(what, error);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) return out;
    }
  }
  return {
    photoBase: supabaseUrl,
    async account() {
      const { data, error } = await sb.from("ebay_account").select("*").eq("id", 1).single();
      if (error) fail("ebay_account", error);
      return data as Account;
    },
    async saveAccount(patch) {
      const { error } = await sb.from("ebay_account").update(patch).eq("id", 1);
      if (error) fail("ebay_account speichern", error);
    },
    async saveAccountIf(expect, patch) {
      let q = sb.from("ebay_account").update(patch).eq("id", 1).eq("environment", expect.environment);
      q = expect.refresh_token === null ? q.is("refresh_token", null) : q.eq("refresh_token", expect.refresh_token);
      const { data, error } = await q.select("id");
      if (error) fail("ebay_account bedingt speichern", error);
      return (data?.length ?? 0) > 0;
    },
    async tryLock(holder, seconds) {
      const { data, error } = await sb.rpc("ebay_try_lock", { p_holder: holder, p_seconds: seconds });
      if (error) fail("ebay_try_lock", error);
      return data === true;
    },
    async unlock(holder) {
      const { error } = await sb.rpc("ebay_unlock", { p_holder: holder });
      if (error) console.error("[ebay] unlock:", error.message);
    },
    async consumeState(state) {
      const { data, error } = await sb.from("ebay_account").update({ oauth_state: null, oauth_state_expires_at: null })
        .eq("id", 1).eq("oauth_state", state).gt("oauth_state_expires_at", new Date().toISOString()).select("id");
      if (error) fail("ebay_account state verbrauchen", error);
      return (data?.length ?? 0) > 0;
    },
    async openRows(extraId) {
      const rows = await all<EbayRow>("ebay_listings", (f, t) =>
        sb.from("ebay_listings").select(ROW_COLS).neq("state", "beendet").order("listing_id").range(f, t));
      if (extraId && !rows.some((r) => r.listing_id === extraId)) {
        const { data, error } = await sb.from("ebay_listings").select(ROW_COLS).eq("listing_id", extraId).maybeSingle();
        if (error) fail("ebay_listings", error);
        if (data) rows.push(data as EbayRow);
      }
      return rows;
    },
    async soll(ids) {
      const listings = await all<SollListing>("listings", (f, t) =>
        sb.from("listings").select(LISTING_COLS).eq("channel_id", "ebay").eq("status", "aktiv").eq("deleted", false)
          .order("listing_id").range(f, t));
      const have = new Set(listings.map((l) => l.listing_id));
      for (const part of chunks(ids.filter((id) => !have.has(id)), CHUNK)) {
        const { data, error } = await sb.from("listings").select(LISTING_COLS).in("listing_id", part);
        if (error) fail("listings", error);
        listings.push(...((data ?? []) as SollListing[]));
      }
      const listingIds = listings.map((l) => l.listing_id);
      const items: SollItem[] = [];
      const photos: Photo[] = [];
      for (const part of chunks(listingIds, CHUNK)) {
        items.push(...await all<SollItem>("listing_items", (f, t) =>
          sb.from("listing_items").select(ITEM_COLS).in("listing_id", part).eq("deleted", false)
            .order("listing_id").order("copy_id").range(f, t)));
        photos.push(...await all<Photo>("listing_photos", (f, t) =>
          sb.from("listing_photos").select("photo_id,listing_id,path,sort,deleted").in("listing_id", part).eq("deleted", false)
            .order("photo_id").range(f, t)));
      }
      const liveCopyIds = new Set<string>();
      for (const part of chunks([...new Set(items.map((i) => i.copy_id))], CHUNK)) {
        const { data, error } = await sb.from("card_copies").select("copy_id").in("copy_id", part)
          .eq("deleted", false).is("sold_in", null);
        if (error) fail("card_copies", error);
        for (const r of data ?? []) liveCopyIds.add(String(r.copy_id));
      }
      return { listings, items, liveCopyIds, photos };
    },
    async liveOfferCount(env) {
      const { count, error } = await sb.from("ebay_listings").select("listing_id", { count: "exact", head: true })
        .eq("environment", env).in("state", ["online", "fehler"]).not("offer_id", "is", null);
      if (error) fail("ebay_listings zählen", error);
      return count ?? 0;
    },
    async saveRow(row) {
      const { error } = await sb.from("ebay_listings").upsert(row, { onConflict: "listing_id" });
      if (error) fail("ebay_listings speichern", error);
    },
    // --- H3b2 ---
    async orders(ids) {
      const out: OrderRow[] = [];
      for (const part of chunks(ids, CHUNK)) {
        const { data, error } = await sb.from("ebay_orders").select(ORDER_COLS).in("order_id", part);
        if (error) fail("ebay_orders", error);
        out.push(...((data ?? []) as OrderRow[]));
      }
      return out;
    },
    async saveOrder(row) {
      const { error } = await sb.from("ebay_orders").upsert(row, { onConflict: "order_id" });
      if (error) fail("ebay_orders speichern", error);
    },
    async openFeeOrders(env, limit) {
      const { data, error } = await sb.from("ebay_orders").select(ORDER_COLS).eq("environment", env).eq("status", "gebucht")
        .eq("fees_final", false).order("order_id").limit(limit);
      if (error) fail("ebay_orders offen", error);
      return (data ?? []) as OrderRow[];
    },
    async saleWorld(listingIds) {
      const listings = await all<ListingHead>("listings", (f, t) =>
        sb.from("listings").select(HEAD_COLS).eq("status", "aktiv").eq("deleted", false).order("listing_id").range(f, t));
      const have = new Set(listings.map((l) => l.listing_id));
      for (const part of chunks(listingIds.filter((id) => !have.has(id)), CHUNK)) {
        const { data, error } = await sb.from("listings").select(HEAD_COLS).in("listing_id", part).eq("deleted", false);
        if (error) fail("listings", error);
        listings.push(...((data ?? []) as ListingHead[]));
      }
      const items: ListingItemRow[] = [];
      for (const part of chunks(listings.map((l) => l.listing_id), CHUNK)) {
        items.push(...await all<ListingItemRow>("listing_items", (f, t) =>
          sb.from("listing_items").select(WORLD_ITEM_COLS).in("listing_id", part).eq("deleted", false)
            .order("listing_id").order("copy_id").range(f, t)));
      }
      const live = new Set<string>();
      for (const part of chunks([...new Set(items.map((i) => i.copy_id))], CHUNK)) {
        const { data, error } = await sb.from("card_copies").select("copy_id").in("copy_id", part).eq("deleted", false).is("sold_in", null);
        if (error) fail("card_copies", error);
        for (const r of data ?? []) live.add(String(r.copy_id));
      }
      return { listings, items, live };
    },
    async cardsFor(copyIds) {
      const out: Record<string, CardForCopy> = {};
      for (const part of chunks(copyIds, CHUNK)) {
        const { data, error } = await sb.from("card_copies").select("copy_id,card_id,set_code,language,rarity,edition,condition").in("copy_id", part);
        if (error) fail("card_copies", error);
        for (const cp of data ?? []) {
          const { data: card, error: e2 } = await sb.from("cards").select("price,price_first_ed").eq("id", cp.card_id)
            .eq("set_code", cp.set_code).eq("language", cp.language).eq("rarity", cp.rarity).maybeSingle();
          if (e2) fail("cards", e2);
          out[String(cp.copy_id)] = { card: card ?? null, copy: { edition: cp.edition, condition: cp.condition } };
        }
      }
      return out;
    },
    async ebayChannel() {
      const { data, error } = await sb.from("sale_channels").select("name,fee_percent").eq("channel_id", "ebay").maybeSingle();
      if (error) fail("sale_channels", error);
      return { name: data?.name ?? "eBay", fee_percent: data?.fee_percent == null ? null : Number(data.fee_percent) };
    },
    async bookSale(sale, items) {
      const { error } = await sb.rpc("book_sale", { p_sale: sale, p_items: items });
      if (!error) return "ok";
      if (error.message === ALREADY_BOOKED) return "exists";
      // raise exception in plpgsql -> P0001: fachliche Ablehnung (Einzelfehler); alles andere bricht den Lauf ab.
      if ((error as { code?: string }).code === "P0001") throw new BookRejected(error.message);
      fail("book_sale", error);
    },
    async cancelSale(saleId) {
      const { error } = await sb.rpc("cancel_sale", { p_sale_id: saleId });
      if (error) fail("cancel_sale", error);
    },
    async saleForUpdate(saleId) {
      const { data: head, error } = await sb.from("sales")
        .select("sale_id,sold_on,channel_id,channel_name,gross,fees,shipping,note,status").eq("sale_id", saleId).eq("deleted", false).maybeSingle();
      if (error) fail("sales", error);
      if (!head) return null;
      const { data: items, error: e2 } = await sb.from("sale_items").select("copy_id,value_at_sale").eq("sale_id", saleId).eq("deleted", false);
      if (e2) fail("sale_items", e2);
      return { head, items: items ?? [] } as SaleForUpdate;
    },
    async updateSale(sale, shares) {
      const { error } = await sb.rpc("update_sale", { p_sale: sale, p_shares: shares, p_returned: [] });
      if (error) fail("update_sale", error);
    },
    async applyListingSale(listingId, saleId, r) {
      if (r.status === "verkauft") {
        const { error } = await sb.from("listings").update({ status: "verkauft", sale_id: saleId }).eq("listing_id", listingId).eq("status", "aktiv");
        if (error) fail("listings verkauft", error);
        return;
      }
      for (const id of r.removeCopyIds) {
        const { error } = await sb.from("listing_items").update({ deleted: true }).eq("listing_id", listingId).eq("copy_id", id);
        if (error) fail("listing_items", error);
      }
      if (r.priceCents != null) {
        const { error } = await sb.from("listings").update({ price: r.priceCents / 100 }).eq("listing_id", listingId).neq("price", r.priceCents / 100);
        if (error) fail("listings Preis", error);
      }
    },
    async cleanupListings(c) {
      for (const it of c.removeItems) {
        const { error } = await sb.from("listing_items").update({ deleted: true }).eq("listing_id", it.listing_id).eq("copy_id", it.copy_id);
        if (error) fail("listing_items", error);
      }
      for (const id of c.endListings) {
        const { error } = await sb.from("listings").update({ status: "beendet" }).eq("listing_id", id).eq("status", "aktiv");
        if (error) fail("listings beenden", error);
      }
    },
    async addNotices(n) {
      if (n.length === 0) return;
      const { error } = await sb.from("sale_notices").upsert(n, { onConflict: "notice_id", ignoreDuplicates: true });
      if (error) fail("sale_notices", error);
    },
    async bumpSoldSeen(listingId, qty) {
      const { data, error } = await sb.from("ebay_listings").select("sold_seen").eq("listing_id", listingId).maybeSingle();
      if (error) fail("ebay_listings", error);
      if (!data) return;
      const { error: e2 } = await sb.from("ebay_listings").update({ sold_seen: (data.sold_seen ?? 0) + qty }).eq("listing_id", listingId);
      if (e2) fail("ebay_listings sold_seen", e2);
    },
  };
}
