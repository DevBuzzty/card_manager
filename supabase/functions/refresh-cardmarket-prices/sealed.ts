// supabase/functions/refresh-cardmarket-prices/sealed.ts
// Spec G3 §5 — Trend-Regel fuer Sealed-Zeilen. Rein, ohne Netz; index.ts laedt und schreibt.
// ZWILLING: desktop/electron/sealed-prices.cjs (Desktop-Bulk-Schritt C). Beide laufen gegen
// docs/fixtures/portfolio/sealed-prices.json (sealed_test.ts bzw. sealed-prices.test.cjs).
// Wer eine Seite aendert, aendert beide.
export type SealedRow = { sealed_id: string; cm_product_id: number; price: number | null };
export type SealedUpdate = { sealed_id: string; cm_product_id: number; price: number };

/** Erster gueltiger Trend (endliche Zahl > 0) je idProduct. 0, null und Text zaehlen nicht; kein Rueckfall auf low/avg. */
export function trendById(priceGuides: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(priceGuides)) return out;
  for (const g of priceGuides as Array<{ idProduct?: unknown; trend?: unknown } | null>) {
    const id = Number(g?.idProduct);
    const t = g?.trend;
    if (out.has(id) || typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
    out.set(id, t);
  }
  return out;
}

/** Neue Preise nur, wenn ein gueltiger Trend existiert und er vom gespeicherten Preis abweicht. Reihenfolge der Zeilen. */
export function pickSealedUpdates(rows: SealedRow[], priceGuides: unknown): SealedUpdate[] {
  const trends = trendById(priceGuides);
  const out: SealedUpdate[] = [];
  for (const r of rows ?? []) {
    const t = trends.get(Number(r.cm_product_id));
    if (t == null) continue;
    if (r.price != null && Number(r.price) === t) continue;
    out.push({ sealed_id: r.sealed_id, cm_product_id: Number(r.cm_product_id), price: t });
  }
  return out;
}
