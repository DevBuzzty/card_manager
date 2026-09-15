import FACTORS from '../../electron/condition-factors.json' with { type: 'json' };
import { fmtEUR, fmtNum } from './format.js';

export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
export const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];
export const EDITION_LABELS = { first: '1st Ed', unlimited: 'Unlimited', limited: 'Limited', unknown: 'Unbek.' };

export function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// Spec G4 §6 — ZWILLING: desktop/electron/valuation.cjs (unitPrice/valueOf/unitPriceCaseSql) und
// android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt (unitPrice/valueOf).
// Gemeinsame Fixture: docs/fixtures/valuation/first-ed.json. Wer eine Fassung aendert, aendert alle.
export function unitPrice(card, copy) {
  if (copy && copy.edition === 'first' && card && card.price_first_ed != null) return Number(card.price_first_ed);
  return Number(card && card.price) || 0;
}

// copies: [{ edition, condition, count? }] — count defaults to 1.
export function valueOf(card, copies) {
  if (!copies || copies.length === 0) return 0;
  let v = 0;
  for (const c of copies) v += unitPrice(card, c) * conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(v * 100) / 100;
}

// Spec G4 §7 — Preiszeile im Karten-Detail. ZWILLING: Valuation.firstEdLine (Kotlin), Fixture-Abschnitt line.
export function firstEdLine(card) {
  if (!card || card.price_first_ed == null) return null;
  const line = `Basis ${fmtEUR(card.price)} · 1st Ed ${fmtEUR(card.price_first_ed)}`;
  return card.cm_first_ed_factor == null ? line : `${line} (×${fmtNum(card.cm_first_ed_factor)})`;
}

// [{edition, condition, ...}] -> [{edition, condition, count}] in display order.
export function groupCopies(copies) {
  const m = new Map();
  for (const c of copies || []) {
    const key = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(key, (m.get(key) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition))
      || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}
