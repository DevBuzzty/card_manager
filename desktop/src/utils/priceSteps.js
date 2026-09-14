import FAMILIES from '../../electron/price-families.json' with { type: 'json' };

// Spec G1 §4.5 — Stufenlinie des Preisverlaufs.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/PriceSteps.kt. Beide laufen gegen
// docs/fixtures/portfolio/price-steps.json. Wer eine Seite aendert, aendert beide.

export const familyOfSource = (source) => FAMILIES[source] || 'unknown';
export const FAMILY_LABELS = { cm: 'Cardmarket', ygo: 'YGOPRODeck', manual: 'manuell', unknown: 'unbekannt' };

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDaysUtc(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const fmtDayDE = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

export function computeSteps(rows, today, windowDays) {
  const sorted = [...(rows || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  if (sorted.length === 0) return { kind: 'none', points: [], markers: [] };
  if (sorted.length === 1) {
    return { kind: 'flat', flatDay: sorted[0].day, flatPrice: Number(sorted[0].price), points: [], markers: [] };
  }
  const start = addDaysUtc(today, -windowDays);
  const points = [];
  const markers = [];
  let before = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.day < start) { before = r; continue; }
    if (r.day > today) continue;
    if (points.length === 0 && before && r.day !== start) points.push({ day: start, price: Number(before.price) });
    points.push({ day: r.day, price: Number(r.price) });
    const prev = sorted[i - 1];
    if (prev && familyOfSource(prev.source) !== familyOfSource(r.source)) {
      markers.push({ day: r.day, family: familyOfSource(r.source) });
    }
  }
  if (points.length === 0 && before) points.push({ day: start, price: Number(before.price) });
  const last = points[points.length - 1];
  if (last && last.day !== today) points.push({ day: today, price: last.price });
  return { kind: 'series', points, markers };
}
