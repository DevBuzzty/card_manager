// Mehrfachauswahl in der Kartenliste (Spec I §5.1, Plan 2026-09-26) -- welche Exemplare zur Auswahl gehören, und die Texte.
// ZWILLING: android .../ml/Selection.kt. Gemeinsame Fixture: docs/fixtures/copies/selection.json. Wer eine Fassung ändert,
// ändert beide. Sortierung per Codeeinheiten.
import { printingKey, copyKey } from './printingKey.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// groups: Gruppen der Kartenliste ({ id, variants: [cards-Zeile] }); selected: Set/Array der Gruppen-ids;
// copies: Exemplare (card_copies-Zeilen); containers: aktiver Behälter-Filter (leer = kein Filter).
// -> lebende Exemplare aller Drucke der gewählten Karten (bei Behälter-Filter nur die darin), sortiert nach copy_id.
export function selectionCopies(groups, selected, copies, containers = []) {
  const want = new Set(selected);
  const keys = new Set();
  for (const g of groups || []) if (want.has(g.id)) for (const v of g.variants || []) keys.add(printingKey(v));
  const inBox = containers.length > 0 ? new Set(containers) : null;
  return (copies || [])
    .filter((c) => !c.deleted && keys.has(copyKey(c)) && (!inBox || inBox.has(c.container_id)))
    .sort((a, b) => cmp(a.copy_id, b.copy_id));
}

const cardsWord = (n) => (n === 1 ? 'Karte' : 'Karten');
const copiesWord = (n) => (n === 1 ? 'Exemplar' : 'Exemplare');

export function selectionText(cards, copies) {
  if (cards === 0) return 'Nichts ausgewählt';
  return `${cards} ${cardsWord(cards)} · ${copies} ${copiesWord(copies)}`;
}

export function sellSubtitle(cards, copies) {
  return `${cards} ${cardsWord(cards)} · ${copies} ${copiesWord(copies)} ausgewählt`;
}

// target: Name des Ziel-Behälters oder null (= aus dem Behälter nehmen).
export function moveText(count, target) {
  if (count === 0) return 'Nichts verschoben – alle Exemplare waren schon dort';
  if (target == null) return count === 1 ? '1 Exemplar aus seinem Behälter genommen' : `${count} Exemplare aus ihren Behältern genommen`;
  return `${count} ${copiesWord(count)} nach „${target}“ verschoben`;
}
