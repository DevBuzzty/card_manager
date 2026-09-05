import FACTORS from '../../electron/condition-factors.json' with { type: 'json' };

export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
export const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];
export const EDITION_LABELS = { first: '1st Ed', unlimited: 'Unlimited', limited: 'Limited', unknown: 'Unbek.' };

export function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

export function valueOf(price, copies) {
  const p = Number(price) || 0;
  if (!p || !copies || copies.length === 0) return 0;
  let f = 0;
  for (const c of copies) f += conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(p * f * 100) / 100;
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
