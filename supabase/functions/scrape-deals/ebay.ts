// supabase/functions/scrape-deals/ebay.ts
// eBay Browse API adapter for the Deals scraper. Official API (no scraping): OAuth app token
// (client-credentials) -> item_summary/search. Fixed-price, EBAY_DE, EUR, ship-to-DE.
// Missing EBAY_CLIENT_ID/SECRET -> scrapeEbay returns [] (eBay silently disabled).
import type { Item } from "./index.ts"; // type-only: not executed at runtime (no Deno.serve on import)

// Build the Browse `filter` value. `new` restricts to new condition ids; `used`/`any` do not
// (used is enforced by post-filtering, see shouldDropForUsed).
export function ebayFilter(maxPrice: number, condition: string): string {
  const parts = ["buyingOptions:{FIXED_PRICE}", "deliveryCountry:DE"];
  if (maxPrice > 0) parts.push(`price:[..${maxPrice}],priceCurrency:EUR`);
  if (condition === "new") parts.push("conditionIds:{1000|1500}");
  return parts.join(",");
}

export function isNewConditionId(id: string | undefined): boolean {
  return id === "1000" || id === "1500";
}

// For a 'used' watch we send no condition filter and instead drop the new items here, so
// "used" means everything non-new (used, refurbished, for-parts) without enumerating ids.
export function shouldDropForUsed(summary: any, condition: string): boolean {
  return condition === "used" && isNewConditionId(String(summary?.conditionId ?? ""));
}

export function mapEbayItem(s: any): Item | null {
  const id = s?.itemId, url = s?.itemWebUrl;
  if (!id || !url) return null;
  const price = s?.price?.currency === "EUR" ? Number(s.price.value) : null;
  return {
    source: "ebay",
    listingId: String(id),
    title: s.title ?? "",
    price: Number.isFinite(price as number) ? (price as number) : null,
    url,
    imageUrl: s?.image?.imageUrl ?? s?.thumbnailImages?.[0]?.imageUrl,
  };
}

// App token cached with expiry (a warm isolate is reused across cron runs; the token lives ~2h).
let tokenCache: { token: string; exp: number } | null = null;

export async function ebayToken(): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token;
  const id = Deno.env.get("EBAY_CLIENT_ID"), secret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) { console.error(`[ebay] token HTTP ${res.status}`); return null; }
  const j = await res.json();
  if (!j.access_token) return null;
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in ?? 7200) - 60) * 1000 };
  return tokenCache.token;
}

export async function scrapeEbay(query: string, watch: any): Promise<Item[]> {
  const token = await ebayToken();
  if (!token) return []; // secrets missing or token failed -> eBay disabled for this run
  const condition = (watch?.condition ?? "any") as string;
  const max = Number(watch?.max_price) || 0;
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("filter", ebayFilter(max, condition));
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE" },
  });
  if (res.status === 401) { tokenCache = null; } // force refresh next run
  if (!res.ok) { console.error(`[ebay] search HTTP ${res.status} for "${query}"`); return []; }
  const j = await res.json();
  const out: Item[] = [];
  for (const s of j.itemSummaries ?? []) {
    if (shouldDropForUsed(s, condition)) continue;
    const it = mapEbayItem(s);
    if (it) out.push(it);
  }
  return out;
}
