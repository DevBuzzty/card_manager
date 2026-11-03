// supabase/functions/resolve-cm-product/fake-cache-store.ts -- NUR für Tests: cm_resolve_cache im Speicher, zählt Aufrufe.
import { CacheFehler, type CacheRow, type CacheStore } from "./cache-store.ts";

type Fail = { code: string; message: string };
export function fakeCacheStore(init: { rows?: CacheRow[]; failRead?: Fail; failWrite?: Fail } = {}) {
  const key = (r: Pick<CacheRow, "card_id" | "code_key" | "rarity_key">) => `${r.card_id}|${r.code_key}|${r.rarity_key}`;
  const rows = new Map<string, CacheRow>((init.rows ?? []).map((r) => [key(r), structuredClone(r)]));
  const reads: { cardId: string; codeKeys: string[] }[] = [];
  const writes: CacheRow[][] = [];
  const store: CacheStore = {
    lesen(cardId, codeKeys) {
      reads.push({ cardId, codeKeys: [...codeKeys] });
      if (init.failRead) return Promise.reject(new CacheFehler(init.failRead.message, init.failRead.code));
      return Promise.resolve(
        [...rows.values()].filter((r) => r.card_id === cardId && codeKeys.includes(r.code_key)).map((r) => structuredClone(r)),
      );
    },
    schreiben(batch) {
      writes.push(structuredClone(batch));
      if (init.failWrite) return Promise.reject(new CacheFehler(init.failWrite.message, init.failWrite.code));
      // Wie Postgres: doppelte Schlüssel in einem Upsert werden abgelehnt.
      const keys = batch.map(key);
      if (new Set(keys).size !== keys.length) {
        return Promise.reject(new CacheFehler("ON CONFLICT DO UPDATE command cannot affect row a second time", "21000"));
      }
      for (const r of batch) rows.set(key(r), structuredClone(r));
      return Promise.resolve();
    },
  };
  return { store, rows, reads, writes };
}
