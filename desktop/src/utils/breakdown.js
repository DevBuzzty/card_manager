import { conditionFactor, unitPrice } from './valuation.js';

// Spec G1 §4.6 — Aufteilung nach Wert. Karten-Dimensionen nutzen `value`/`quantity` aus get-collection;
// die Binder-Dimension rechnet pro lebendem Exemplar (Preis x Zustandsfaktor).
// Spec G4: die Binder-Dimension nutzt unitPrice (1st-Ed-Preis fuer edition = 'first').
export const UNSORTED_LABEL = 'Nicht einsortiert';
export const UNKNOWN_LABEL = 'Unbekannt';

export function typeGroup(type) {
  const t = String(type || '');
  if (t.includes('Spell')) return 'Zauber';
  if (t.includes('Trap')) return 'Falle';
  if (t.includes('Monster')) return 'Monster';
  return 'Sonstige';
}

const round2 = (x) => Math.round(x * 100) / 100;
const keyOf = (id, s, l, r) => `${id}|${s || 'Unknown'}|${l || 'DE'}|${r || 'Unknown'}`;

function finish(map) {
  return Array.from(map.entries())
    .map(([label, g]) => ({ label, count: g.count, value: round2(g.value) }))
    .sort((a, b) => (b.value - a.value) || a.label.localeCompare(b.label));
}

export function valueBreakdown({ cards = [], copies = [], containers = [], dimension }) {
  const m = new Map();
  const add = (label, count, value) => {
    const g = m.get(label) || { count: 0, value: 0 };
    g.count += count; g.value += value; m.set(label, g);
  };
  if (dimension === 'binder') {
    const byKey = new Map(cards.map((c) => [keyOf(c.id, c.set_code, c.language, c.rarity), c]));
    const names = new Map(containers.map((c) => [c.container_id, c.name]));
    for (const cp of copies) {
      const label = (cp.container_id && names.get(cp.container_id)) || UNSORTED_LABEL;
      add(label, 1, unitPrice(byKey.get(keyOf(cp.card_id, cp.set_code, cp.language, cp.rarity)), cp) * conditionFactor(cp.condition));
    }
    return finish(m);
  }
  for (const c of cards) {
    const label = dimension === 'type' ? typeGroup(c.type)
      : dimension === 'set' ? (c.set_code && c.set_code !== 'Unknown' ? c.set_code.split('-')[0] : UNKNOWN_LABEL)
      : (c.rarity && c.rarity !== 'Unknown' ? c.rarity : UNKNOWN_LABEL);
    add(label, Number(c.quantity) || 0, Number(c.value) || 0);
  }
  return finish(m);
}
