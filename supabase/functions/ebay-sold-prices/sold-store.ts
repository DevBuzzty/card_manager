// supabase/functions/ebay-sold-prices/sold-store.ts
// eBay „zuletzt verkauft" §5/§6 -- schmaler Datenbank-Zugang der Funktion; Tests nutzen fake-sold-store.ts.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Printing } from "./match.ts";
import type { Summary } from "./summarize.ts";

export type Access = "unbekannt" | "aktiv" | "fehlt";
export type State = { access: Access; last_error: string | null; last_run_at: string | null; calls_today: number; calls_day: string | null };
export type SoldRow = Printing & Omit<Summary, "status"> & { status: "ok" | "zu_wenig" | "fehler"; checked_at: string };
export interface SoldStore {
  candidates(minPrice: number, freshBefore: string, limit: number): Promise<Printing[]>;
  upsert(row: SoldRow): Promise<void>;
  state(): Promise<State>;
  setState(patch: Partial<State>): Promise<void>;
}
export const rowKey = (p: Printing) => `${p.card_id}|${p.set_code}|${p.language}|${p.rarity}`;

export function supabaseSoldStore(sb: SupabaseClient): SoldStore {
  return {
    async candidates(minPrice, freshBefore, limit) {
      const { data, error } = await sb.rpc("ebay_sold_candidates", { min_price: minPrice, fresh_before: freshBefore, max_rows: limit });
      if (error) throw new Error(`Kandidaten: ${error.message}`);
      return (data ?? []) as Printing[];
    },
    async upsert(row) {
      const { error } = await sb.from("ebay_sold_prices").upsert(row, { onConflict: "card_id,set_code,language,rarity" });
      if (error) throw new Error(`Speichern: ${error.message}`);
    },
    async state() {
      const { data, error } = await sb.from("ebay_insights_state").select("access,last_error,last_run_at,calls_today,calls_day").eq("id", 1).maybeSingle();
      if (error) throw new Error(`Status: ${error.message}`);
      return (data ?? { access: "unbekannt", last_error: null, last_run_at: null, calls_today: 0, calls_day: null }) as State;
    },
    async setState(patch) {
      const { error } = await sb.from("ebay_insights_state").update(patch).eq("id", 1);
      if (error) throw new Error(`Status speichern: ${error.message}`);
    },
  };
}
