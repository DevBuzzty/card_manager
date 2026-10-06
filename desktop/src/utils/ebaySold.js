// eBay „zuletzt verkauft" E1 §8 -- Anzeigezeile im Karten-Detail. ZWILLING: android/.../cloud/EbaySold.kt,
// gemeinsame Fixture docs/fixtures/ebay/sold-line.json. Datum aus den ersten 10 Zeichen des ISO-Textes (UTC-Tag),
// damit beide Plattformen ohne Zeitzonen-Umrechnung dasselbe zeigen.
import { fmtEUR } from './format.js';

const dayMonth = (iso) => (typeof iso === 'string' && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : null);

export function ebaySoldLine(access, row) {
  if (access === 'fehlt') return 'eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet';
  if (!row) return 'eBay: noch nicht geprüft';
  if (row.status === 'fehler') return 'eBay: Abruf fehlgeschlagen';
  if (row.status !== 'ok' || row.median_all == null) return `eBay: zu wenig Verkäufe (${Number(row.n_all) || 0})`;
  let line = `eBay verkauft: ${fmtEUR(row.median_all)} · ${row.n_all} Verkäufe`;
  const d = dayMonth(row.last_sold_at);
  if (d) line += ` · zuletzt ${d}`;
  if (row.median_first != null) line += ` · 1. Aufl. ${fmtEUR(row.median_first)} (${row.n_first})`;
  return line;
}

export const ebaySoldCanCheck = (access) => access !== 'fehlt';
