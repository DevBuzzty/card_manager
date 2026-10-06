// supabase/functions/ebay-sold-prices/fake-sold-store.ts -- NUR für Tests: Store im Speicher.
import type { Printing } from "./match.ts";
import { rowKey, type SoldRow, type SoldStore, type State } from "./sold-store.ts";

export function fakeSoldStore(init: { candidates?: Printing[]; state?: Partial<State> } = {}) {
  const rows = new Map<string, SoldRow>();
  const state: State = { access: "unbekannt", last_error: null, last_run_at: null, calls_today: 0, calls_day: null, ...init.state };
  const candidateCalls: { minPrice: number; freshBefore: string; limit: number }[] = [];
  const store: SoldStore = {
    candidates: (minPrice, freshBefore, limit) => {
      candidateCalls.push({ minPrice, freshBefore, limit });
      return Promise.resolve((init.candidates ?? []).slice(0, limit));
    },
    upsert: (row) => { rows.set(rowKey(row), structuredClone(row)); return Promise.resolve(); },
    state: () => Promise.resolve({ ...state }),
    setState: (patch) => { Object.assign(state, patch); return Promise.resolve(); },
  };
  return { store, rows, state, candidateCalls };
}
