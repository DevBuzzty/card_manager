// supabase/functions/refresh-cardmarket-prices/index.ts
// Supabase Edge Function: apply Cardmarket's daily `trend` price to every cloud row whose
// cm_product_id the desktop has mirrored, so the phone stays current without the desktop.
// Deploy:  supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt so pg_cron can call it; optional secret below)
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//   Optional hardening: set CM_TRIGGER_SECRET to require header `x-cm-secret` on every call.
// See supabase/README_cardmarket_cloud.md and docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { pickTrends } from "./prices.ts";

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
      .range(from, from + PAGE - 1);
    if (error) return json({ error: `select: ${error.message}` }, 500);
    for (const r of data ?? []) if (r.cm_product_id != null) ids.add(Number(r.cm_product_id));
    if (!data || data.length < PAGE) break;
  }
  if (ids.size === 0) return json({ needed: 0, found: 0, updated: 0 });

  // 2. Today's price guide (≈17 MB; parses in well under the 2 s CPU limit).
  const res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) return json({ error: `guide HTTP ${res.status}` }, 502);
  let guide: unknown;
  try { guide = await res.json(); } catch (e) { return json({ error: `guide parse: ${(e as Error).message}` }, 502); }
  const prices = pickTrends(guide, ids);
  if (prices.length === 0) return json({ needed: ids.size, found: 0, updated: 0 });

  // 3. One UPDATE for everything; only rows whose price actually changes are touched.
  const { data: updated, error: rpcErr } = await supabase.rpc("apply_cardmarket_prices", { prices });
  if (rpcErr) return json({ error: `rpc: ${rpcErr.message}` }, 500);

  const body = { needed: ids.size, found: prices.length, updated: Number(updated ?? 0) };
  console.log("[refresh-cardmarket-prices]", JSON.stringify(body));
  return json(body);
});
