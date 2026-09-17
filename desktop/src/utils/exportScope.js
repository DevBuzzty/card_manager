// Spec F1 §4 -- Export-Dialog: Formate, Umfang und "Aktueller Filter" der Sammlung als Exemplar-IDs.
// Die Sammlungsliste filtert Gruppen (ein Passcode, mehrere Printings); exportiert werden nur die Exemplare, die auch die
// Printing-Filter (Sprache, Seltenheit, Set) und die Exemplar-Filter (Zustand, Edition, Behälter, Tags) erfüllen.
import { parseTags } from './tags.js';
import { printingKey } from './printingKey.js';

export const EXPORT_FORMAT_OPTIONS = [
  { value: 'carddex', label: 'Card Dex (CSV)' },
  { value: 'dragonshield', label: 'Dragon Shield (CSV)' },
  { value: 'ygoprodeck', label: 'YGOPRODeck (CSV)' },
  { value: 'wantslist', label: 'Cardmarket-Wantslist (Text)' },
  { value: 'salelist', label: 'Verkaufsliste (Text)' },
];
export const NOTHING_TO_EXPORT = 'Nichts zu exportieren';

const ALL = 'All';
const setOf = (code) => String(code || '').split('-')[0];

// groups: gefilterte Gruppen der Sammlungsliste ({ variants: [cards-Zeile] }); copiesByPrinting: printingKey -> Exemplare;
// filters: { lang, rarity, set, condition, edition, containers: string[], tags: string[] } ('All'/leer = kein Filter).
export function filterCopyIds(groups, copiesByPrinting, filters = {}) {
  const f = { lang: ALL, rarity: ALL, set: ALL, condition: ALL, edition: ALL, containers: [], tags: [], ...filters };
  const wantedTags = f.tags.map((t) => t.toLowerCase());
  const ids = [];
  for (const g of groups || []) {
    for (const v of g.variants || []) {
      if (f.lang !== ALL && v.language !== f.lang) continue;
      if (f.rarity !== ALL && v.rarity !== f.rarity) continue;
      if (f.set !== ALL && setOf(v.set_code) !== f.set) continue;
      for (const cp of (copiesByPrinting && copiesByPrinting[printingKey(v)]) || []) {
        if (f.condition !== ALL && cp.condition !== f.condition) continue;
        if (f.edition !== ALL && cp.edition !== f.edition) continue;
        if (f.containers.length > 0 && !f.containers.includes(cp.container_id)) continue;
        if (wantedTags.length > 0 && !parseTags(cp.tags).some((t) => wantedTags.includes(t.toLowerCase()))) continue;
        ids.push(cp.copy_id);
      }
    }
  }
  return ids;
}

// Umfang fuer den Hauptprozess (collection-export.cjs#loadExportCopies).
export function exportScope(kind, { containerId = null, copyIds = [] } = {}) {
  if (kind === 'container') return { kind: 'container', containerId };
  if (kind === 'filter') return { kind: 'copies', copyIds };
  return { kind: 'all' };
}
