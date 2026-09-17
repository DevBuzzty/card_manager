// Spec F1 §3 -- Vorschau-Regeln im Renderer: Filter Alle/Hinweise/Unbekannt, Auslassen roter Zeilen, wann "Übernehmen"
// aktiv ist. Die Zeilen selbst löst der Hauptprozess auf (electron/carddex-resolve.cjs).
import { EDITION_LABELS } from './valuation.js';

export const PREVIEW_FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'hints', label: 'Hinweise' },
  { value: 'unknown', label: 'Unbekannt' },
];
export const IMPORT_RULES = [
  { value: 'add', label: 'Hinzufügen' },
  { value: 'replace', label: 'Ersetzen' },
  { value: 'skip', label: 'Überspringen' },
];

export function visibleRows(rows, filter) {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === 'hints') return list.filter((r) => r.status === 'yellow');
  if (filter === 'unknown') return list.filter((r) => r.status === 'red');
  return list;
}

// omitted: Set der ausgelassenen Zeilennummern. Aktiv erst, wenn jede rote Zeile ausgelassen ist und etwas übrig bleibt.
export function canApply(rows, omitted) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((r) => r.status === 'red' && !omitted.has(r.line))) return false;
  return list.some((r) => r.action === 'import');
}

// M4 -- Übernehmen bleibt deaktiviert, wenn zwar keine rote Zeile mehr offen ist, aber auch keine Zeile
// action: 'import' hat (z. B. Regel "Überspringen" mit lauter vorhandenen Printings). Ohne diesen Hinweis sieht der
// deaktivierte Knopf wie ein Bug statt einer bewussten Auswahl aus.
export const NOTHING_TO_APPLY = 'Nichts zu übernehmen';
export function nothingToApply(rows, omitted) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((r) => r.status === 'red' && !omitted.has(r.line))) return false;
  return !list.some((r) => r.action === 'import');
}

export function omitAllUnknown(rows) {
  return new Set((Array.isArray(rows) ? rows : []).filter((r) => r.status === 'red').map((r) => r.line));
}

// M6 -- Edition als Anzeigename statt internem Code (EDITION_LABELS aus valuation.js, dieselbe Zuordnung wie in
// CopyChip.jsx/CardDetailPanel.jsx). Der Zustand bleibt der Code (MT/NM/…): das ist im Rest der App (CopyChip,
// CopySheet, BinderView) selbst die Anzeigeform, keine interne Abkürzung.
// Eine Zeile der Liste, z. B. "Dunkler Magier · LOB-DE005 · Ultra Rare · DE · 2× · 1st Ed/NM · Binder Blau · S1 · F3".
export function rowLabel(r) {
  const where = r.container ? [r.container.name, r.page != null ? `S${r.page} · F${r.slot}` : null].filter(Boolean).join(' · ') : null;
  return [r.name || r.printing.id, r.printing.set_code, r.printing.rarity, r.printing.language,
    r.count != null ? `${r.count}×` : null, `${EDITION_LABELS[r.edition] || r.edition}/${r.condition}`, where].filter(Boolean).join(' · ');
}
