// supabase/functions/refresh-cardmarket-prices/index.ts
// Supabase Edge Function: apply Cardmarket's daily `trend` price to every cloud row whose
// cm_product_id the desktop has mirrored, so the phone stays current without the desktop.
// Spec G3 §5: zusaetzlich die lebenden sealed_items (Regel in sealed.ts, RPC apply_cardmarket_sealed_prices).
// Fehlt die Tabelle sealed_items noch, laeuft der Kartendurchgang unveraendert; die Antwort traegt dann sealed.error.
// Deploy:  supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt so pg_cron can call it; optional secret below)
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//   Optional hardening: set CM_TRIGGER_SECRET to require header `x-cm-secret` on every call.
// See supabase/README_cardmarket_cloud.md and docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { pickTrends } from "./prices.ts";
import { pickSealedUpdates, type SealedRow } from "./sealed.ts";

const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0";
const PAGE = 1000; // PostgREST default max rows per request

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CM_TRIGGER_SECRET");
  if (secret && req.headers.get("x-cm-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Every distinct Cardmarket product id we must price (skip deleted rows and manual prices).
  const ids = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("cards")
      .select("cm_product_id")
      .not("cm_product_id", "is", null)
      .eq("deleted", false)
      .neq("price_locked", 2)
      .order("id", { ascending: true }).order("set_code").order("language").order("rarity")
      .range(from, from + PAGE - 1);
    if (error) return json({ error: `select: ${error.message}` }, 500);
    for (const r of data ?? []) if (r.cm_product_id != null) ids.add(Number(r.cm_product_id));
    if (!data || data.length < PAGE) break;
  }

  // 1b. Spec G3 §5: lebende Sealed-Zeilen, seitenweise ueber eine stabile Ordnung. Nie fatal fuer die Karten.
  const sealedRows: SealedRow[] = [];
  let sealedError: string | null = null;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sealed_items")
        .select("sealed_id,cm_product_id,price")
        .eq("deleted", false)
        .order("sealed_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        sealedRows.push({
          sealed_id: String(r.sealed_id),
          cm_product_id: Number(r.cm_product_id),
          price: r.price == null ? null : Number(r.price),
        });
      }
      if (!data || data.length < PAGE) break;
    }
  } catch (e) {
    sealedError = (e as Error).message;
    sealedRows.length = 0;
    console.error("[refresh-cardmarket-prices] sealed skipped:", sealedError);
  }
  const sealedBody = (updated: number) => (sealedError ? { error: sealedError } : { needed: sealedRows.length, updated });

  if (ids.size === 0 && sealedRows.length === 0) {
    return json({ needed: 0, found: 0, updated: 0, sealed: sealedBody(0) });
  }

  // 2. Today's price guide (≈17 MB; parses in well under the 2 s CPU limit).
  let res: Response;
  try { res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } }); }
  catch (e) { return json({ error: `guide fetch: ${(e as Error).message}` }, 502); }
  if (!res.ok) return json({ error: `guide HTTP ${res.status}` }, 502);
  let guide: unknown;
  try { guide = await res.json(); } catch (e) { return json({ error: `guide parse: ${(e as Error).message}` }, 502); }

  // 3. Cards: one UPDATE for everything; only rows whose price actually changes are touched.
  const prices = pickTrends(guide, ids);
  let updated = 0;
  if (prices.length > 0) {
    const { data, error: rpcErr } = await supabase.rpc("apply_cardmarket_prices", { prices });
    if (rpcErr) return json({ error: `rpc: ${rpcErr.message}` }, 500);
    updated = Number(data ?? 0);
  }

  // 4. Sealed: gleiche Trend-Regel wie der Desktop-Bulk-Schritt C (Zwilling sealed.ts ↔ electron/sealed-prices.cjs).
  let sealedUpdated = 0;
  const updates = pickSealedUpdates(sealedRows, (guide as { priceGuides?: unknown } | null)?.priceGuides);
  if (updates.length > 0) {
    const byProduct = new Map<number, { id_product: number; trend: number }>();
    for (const u of updates) byProduct.set(u.cm_product_id, { id_product: u.cm_product_id, trend: u.price });
    const { data, error } = await supabase.rpc("apply_cardmarket_sealed_prices", { prices: [...byProduct.values()] });
    if (error) {
      sealedError = `rpc: ${error.message}`;
      console.error("[refresh-cardmarket-prices] sealed rpc:", error.message);
    } else {
      sealedUpdated = Number(data ?? 0);
    }
  }

  const body = { needed: ids.size, found: prices.length, updated, sealed: sealedBody(sealedUpdated) };
  console.log("[refresh-cardmarket-prices]", JSON.stringify(body));
  return json(body);
});
