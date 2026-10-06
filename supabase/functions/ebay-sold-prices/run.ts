// supabase/functions/ebay-sold-prices/run.ts
// eBay „zuletzt verkauft" §5/§6 -- ein Lauf: Token MIT Insights-Scope (schaltet sich so selbst ein), Kandidaten oder
// ein Druck, je Druck Suche -> Filter -> Median -> speichern. Nie Tokens/Secrets protokollieren.
import { appToken, credsFor, EbayError, type Fetch, INSIGHTS_SCOPE, searchSold, type SoldItem } from "../_shared/ebay-client.ts";
import type { Printing } from "./match.ts";
import type { Access, SoldRow, SoldStore } from "./sold-store.ts";
import { summarizeSales } from "./summarize.ts";

// Kategorie Yu-Gi-Oh!-Einzelkarten auf EBAY_DE ("TCG Einzelkarten", Messung 06.10.2026).
export const YGO_CATEGORY_ID = "183454";
export const FRESH_MS = 7 * 24 * 3600 * 1000;

export type RunOpts = { mode: "cron"; minPrice: number; budget: number } | { mode: "single"; printing: Printing };
export type RunResult = { ok: boolean; access: Access; checked: number; error?: string; row?: SoldRow };
export type RunDeps = { store: SoldStore; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date };

export async function runSold(d: RunDeps, o: RunOpts): Promise<RunResult> {
  const nowIso = d.now().toISOString(), today = nowIso.slice(0, 10);
  const st = await d.store.state();
  let calls = st.calls_day === today ? st.calls_today : 0;
  const finish = async (r: RunResult, err: string | null) => {
    await d.store.setState({ access: r.access, last_error: err, last_run_at: nowIso, calls_today: calls, calls_day: today });
    return err ? { ...r, error: err } : r;
  };

  let creds;
  try { creds = credsFor("production", d.env); }
  catch (e) { return finish({ ok: false, access: st.access, checked: 0 }, (e as Error).message); }

  const getToken = () => appToken(d.fetch, "production", creds, INSIGHTS_SCOPE);
  let token: string;
  try { token = await getToken(); }
  catch (e) {
    if (e instanceof EbayError && e.scopeMissing) return finish({ ok: false, access: "fehlt", checked: 0 }, null);
    return finish({ ok: false, access: st.access, checked: 0 }, (e as Error).message);
  }

  const list = o.mode === "single" ? [o.printing]
    : await d.store.candidates(o.minPrice, new Date(d.now().getTime() - FRESH_MS).toISOString(), o.budget);
  let checked = 0, lastRow: SoldRow | undefined;
  for (const p of list) {
    let items: SoldItem[];
    try {
      calls++;
      try { items = await searchSold(d.fetch, "production", token, p.set_code, YGO_CATEGORY_ID); }
      catch (e) {
        if (!(e instanceof EbayError && e.auth)) throw e;
        token = await getToken(); // 401: Token einmal erneuern
        calls++;
        items = await searchSold(d.fetch, "production", token, p.set_code, YGO_CATEGORY_ID);
      }
    } catch (e) {
      if (e instanceof EbayError && e.scopeMissing) return finish({ ok: false, access: "fehlt", checked }, null);
      if (e instanceof EbayError && (e.transient || e.auth)) return finish({ ok: false, access: "aktiv", checked }, e.message);
      lastRow = { ...p, median_all: null, n_all: 0, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "fehler", checked_at: nowIso };
      await d.store.upsert(lastRow);
      checked++;
      continue;
    }
    lastRow = { ...p, ...summarizeSales(items, p), checked_at: nowIso };
    await d.store.upsert(lastRow);
    checked++;
  }
  return finish({ ok: true, access: "aktiv", checked, ...(o.mode === "single" && lastRow ? { row: lastRow } : {}) }, null);
}
