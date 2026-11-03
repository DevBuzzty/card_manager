// supabase/functions/resolve-cm-product/cache-store.ts -- Spec 2026-11-03 §5.4. Schmaler Zugang zu cm_resolve_cache
// (Service-Rolle; RLS ohne Policy). Fehler werfen CacheFehler mit Postgres-/PostgREST-Code; resolve.ts entscheidet, was folgt.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type CacheRow = {
  card_id: string;
  code_key: string;
  rarity_key: string;
  status: "resolved" | "ambiguous" | "not_found";
  how: "real" | "unique" | "derived" | "blocks" | null;
  reason: string | null;
  cm: number[];
  index_date: string; // YYYY-MM-DD
  checked_at: string; // ISO
  // normName des Namens, mit dem das Ergebnis berechnet wurde (Review-Nachtrag 2). Eine Zeile gilt nur für denselben Namen:
  // ein falscher name_en (Client) kann so keine Zeile für korrekte Anfragen festschreiben. Alte Zeilen: '' -> nie gültig.
  name_norm?: string;
};
export interface CacheStore {
  lesen(cardId: string, codeKeys: string[]): Promise<CacheRow[]>; // EINE Abfrage
  schreiben(rows: CacheRow[]): Promise<void>; // EIN Upsert, Zeilen bereits entdoppelt
}
export class CacheFehler extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}
// PostgREST kennt die Tabelle nicht (PGRST205) bzw. Postgres (42P01): SQL noch nicht eingespielt.
export const tabelleFehlt = (e: unknown) => e instanceof CacheFehler && (e.code === "PGRST205" || e.code === "42P01");

const SPALTEN = "card_id,code_key,rarity_key,status,how,reason,cm,index_date,checked_at,name_norm";

export function supabaseCacheStore(sb: SupabaseClient): CacheStore {
  return {
    async lesen(cardId, codeKeys) {
      const { data, error } = await sb.from("cm_resolve_cache").select(SPALTEN).eq("card_id", cardId).in("code_key", codeKeys);
      if (error) throw new CacheFehler(`Cache lesen: ${error.message}`, error.code ?? null);
      return (data ?? []).map((r) => ({ ...r, cm: ((r.cm ?? []) as unknown[]).map(Number) })) as CacheRow[];
    },
    async schreiben(rows) {
      const { error } = await sb.from("cm_resolve_cache").upsert(rows, { onConflict: "card_id,code_key,rarity_key" });
      if (error) throw new CacheFehler(`Cache schreiben: ${error.message}`, error.code ?? null);
    },
  };
}
