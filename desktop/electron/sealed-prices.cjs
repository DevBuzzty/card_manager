// desktop/electron/sealed-prices.cjs
// Spec G3 §5 — Trend-Regel fuer Sealed-Zeilen (Bulk-Schritt C) und Startpreis im Katalog.
// ZWILLING: supabase/functions/refresh-cardmarket-prices/sealed.ts. Beide laufen gegen
// docs/fixtures/portfolio/sealed-prices.json (sealed-prices.test.cjs bzw. sealed_test.ts).
// Wer eine Seite aendert, aendert beide.

// Erster gueltiger Trend (endliche Zahl > 0) je idProduct. 0, null und Text zaehlen nicht; kein Rueckfall auf low/avg.
function trendById(priceGuides) {
  const out = new Map();
  if (!Array.isArray(priceGuides)) return out;
  for (const g of priceGuides) {
    const id = Number(g && g.idProduct);
    const t = g && g.trend;
    if (out.has(id) || typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue;
    out.set(id, t);
  }
  return out;
}

// rows: [{ sealed_id, cm_product_id, price }]. Neue Preise nur bei gueltigem, abweichendem Trend; Reihenfolge der Zeilen.
function pickSealedUpdates(rows, priceGuides) {
  const trends = trendById(priceGuides);
  const out = [];
  for (const r of rows || []) {
    const t = trends.get(Number(r.cm_product_id));
    if (t == null) continue;
    if (r.price != null && Number(r.price) === t) continue;
    out.push({ sealed_id: r.sealed_id, cm_product_id: Number(r.cm_product_id), price: t });
  }
  return out;
}

module.exports = { trendById, pickSealedUpdates };
