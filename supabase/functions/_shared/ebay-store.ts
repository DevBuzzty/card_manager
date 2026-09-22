// supabase/functions/_shared/ebay-store.ts
// Spec H3b §4.2/§5.1/§8 -- Datenbankzugriff der eBay-Funktionen hinter einer schmalen Schnittstelle (Tests: fake-store.ts).
// Die echte Fassung nutzt die Dienstrolle (SUPABASE_SERVICE_ROLE_KEY): nur sie liest/schreibt ebay_account/ebay_listings.
// PostgREST kappt Antworten bei 1000 Zeilen -> jede wachsende Abfrage blättert über eine stabile Ordnung.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { EbayRow } from "./ebay-plan.ts";

export type Account = {
  environment: string; marketplace: string;
  refresh_token: string | null; refresh_expires_at: string | null; access_token: string | null; access_expires_at: string | null;
  oauth_state: string | null; oauth_state_expires_at: string | null;
  payment_policy_id: string | null; payment_policy_name: string | null;
  fulfillment_policy_id: string | null; fulfillment_policy_name: string | null;
  return_policy_id: string | null; return_policy_name: string | null;
  location_key: string | null; last_run_at: string | null; last_run_summary: string | null; last_error: string | null;
  connected_at: string | null;
};
export type SollData = { listings: SollListing[]; items: SollItem[]; liveCopyIds: Set<string>; photos: Photo[] };

export interface Store {
  photoBase: string;
  account(): Promise<Account>;
  saveAccount(patch: Partial<Account>): Promise<void>;
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
}

const PAGE = 1000;
const CHUNK = 100;
const LISTING_COLS = "listing_id,channel_id,title,description,price,status,deleted";
const ITEM_COLS = "listing_id,copy_id,card_id,name,set_code,language,rarity,edition,condition,image_url,deleted";
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
  };
}
