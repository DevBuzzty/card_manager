// supabase/functions/refresh-cardmarket-prices/prices.ts
// Pure: pick the Cardmarket `trend` for the product ids we need. Cardmarket's price_guide_3.json
// is { priceGuides: [{ idProduct, trend, avg, low, ... }] }; `trend` is null or 0 when there is
// no trend — both are skipped (0 would otherwise be written as a real €0 price).
export type TrendRow = { id_product: number; trend: number };

export function pickTrends(guide: unknown, ids: Set<number>): TrendRow[] {
  const list = (guide as { priceGuides?: unknown } | null)?.priceGuides;
  if (!Array.isArray(list) || ids.size === 0) return [];
  const seen = new Set<number>();
  const out: TrendRow[] = [];
  for (const g of list as Array<{ idProduct?: unknown; trend?: unknown }>) {
    const id = Number(g?.idProduct);
    if (!ids.has(id) || seen.has(id)) continue;
    const t = g?.trend;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
    seen.add(id);
    out.push({ id_product: id, trend: t });
  }
  return out;
}
