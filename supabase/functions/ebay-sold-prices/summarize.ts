// supabase/functions/ebay-sold-prices/summarize.ts
// eBay „zuletzt verkauft" §4 -- Wert eines Drucks aus seinen verkauften Artikeln: Median ab 3 Verkäufen, 1. Auflage getrennt.
import type { SoldItem } from "../_shared/ebay-client.ts";
import { matchSale, type Printing } from "./match.ts";

export type SaleEntry = { title: string; price: number; sold_at: string; url: string | null; first: boolean };
export type Summary = {
  median_all: number | null; n_all: number; median_first: number | null; n_first: number;
  last_sold_at: string | null; last_sold_price: number | null; sales: SaleEntry[]; status: "ok" | "zu_wenig";
};
export const MIN_SALES = 3;
export const MAX_ENTRIES = 20;

export function median3(xs: number[]): number | null {
  if (xs.length < MIN_SALES) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 100) / 100;
}

export function summarizeSales(items: SoldItem[], p: Printing): Summary {
  const hits: SaleEntry[] = [];
  for (const i of items) {
    if (i.currency !== "EUR" || !(typeof i.price === "number" && i.price > 0)) continue;
    const r = matchSale(i.title, i.conditionId, p);
    if (r.ok) hits.push({ title: i.title, price: i.price, sold_at: i.soldAt ?? "", url: i.url, first: r.first });
  }
  // Jüngste zuerst; ohne Datum ("") ans Ende.
  hits.sort((a, b) => (b.sold_at > a.sold_at ? 1 : b.sold_at < a.sold_at ? -1 : 0));
  const firsts = hits.filter((h) => h.first);
  const median_all = median3(hits.map((h) => h.price));
  const latest = hits.find((h) => h.sold_at !== "") ?? null;
  return {
    median_all, n_all: hits.length,
    median_first: median3(firsts.map((h) => h.price)), n_first: firsts.length,
    last_sold_at: latest ? latest.sold_at : null, last_sold_price: latest ? latest.price : null,
    sales: hits.slice(0, MAX_ENTRIES).map((h) => ({ ...h })),
    status: median_all != null ? "ok" : "zu_wenig",
  };
}
