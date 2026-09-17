// Spec F1 §3 -- Vorschau-Regeln im Renderer: Filter Alle/Hinweise/Unbekannt, Auslassen roter Zeilen, wann "Übernehmen"
// aktiv ist. Die Zeilen selbst löst der Hauptprozess auf (electron/carddex-resolve.cjs).
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

export function omitAllUnknown(rows) {
  return new Set((Array.isArray(rows) ? rows : []).filter((r) => r.status === 'red').map((r) => r.line));
}

// Eine Zeile der Liste, z. B. "Dunkler Magier · LOB-DE005 · Ultra Rare · DE · 2× · first/NM · Binder Blau · S1 · F3".
export function rowLabel(r) {
  const where = r.container ? [r.container.name, r.page != null ? `S${r.page} · F${r.slot}` : null].filter(Boolean).join(' · ') : null;
  return [r.name || r.printing.id, r.printing.set_code, r.printing.rarity, r.printing.language,
    r.count != null ? `${r.count}×` : null, `${r.edition}/${r.condition}`, where].filter(Boolean).join(' · ');
}
