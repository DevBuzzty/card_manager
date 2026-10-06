// desktop/electron/ebay-sold.cjs
// eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §7): lokale Leser des Nur-Lese-Spiegels für die IPC-Kanäle.
function soldRowFor(db, p) {
  const r = db.prepare('SELECT * FROM ebay_sold_prices WHERE card_id = ? AND set_code = ? AND language = ? AND rarity = ?')
    .get(String(p.card_id), p.set_code, p.language || 'DE', p.rarity);
  if (!r) return null;
  let sales = [];
  try { const s = JSON.parse(r.sales ?? '[]'); if (Array.isArray(s)) sales = s; } catch { /* kaputter Text -> keine Belege */ }
  return { ...r, sales };
}

function insightsAccess(db) {
  try {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'ebay_insights_state'").get()?.value;
    const a = raw ? JSON.parse(raw)?.access : null;
    return a === 'aktiv' || a === 'fehlt' ? a : 'unbekannt';
  } catch { return 'unbekannt'; }
}

// Frische Zeile aus der Edge-Function-Antwort (Zahlen evtl. als Text) in die Form des lokalen Spiegels bringen.
const NUM_COLS = ['median_all', 'median_first', 'last_sold_price'];
function normalizeSoldRow(row) {
  if (!row) return null;
  const out = { ...row, sales: Array.isArray(row.sales) ? row.sales : [] };
  for (const c of NUM_COLS) if (out[c] != null && out[c] !== '' && !Number.isNaN(Number(out[c]))) out[c] = Number(out[c]);
  return out;
}

module.exports = { soldRowFor, insightsAccess, normalizeSoldRow };
