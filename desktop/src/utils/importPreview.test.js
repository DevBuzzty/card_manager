import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRows, canApply, nothingToApply, NOTHING_TO_APPLY, omitAllUnknown, rowLabel, PREVIEW_FILTERS, IMPORT_RULES } from './importPreview.js';

const P = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const ROWS = [
  { line: 2, status: 'green', action: 'import', printing: P, name: 'Dunkler Magier', count: 2, edition: 'first', condition: 'NM', container: { name: 'Binder Blau' }, page: 1, slot: 3 },
  { line: 3, status: 'yellow', action: 'import', printing: P, name: '', count: 1, edition: 'unknown', condition: 'EX', container: { name: 'Box' }, page: null, slot: null },
  { line: 4, status: 'red', action: 'red', printing: { ...P, id: '1' }, name: 'X', count: null, edition: 'x', condition: 'y', container: null, page: null, slot: null },
];

test('Filter Alle / Hinweise / Unbekannt', () => {
  assert.deepEqual(visibleRows(ROWS, 'all').map((r) => r.line), [2, 3, 4]);
  assert.deepEqual(visibleRows(ROWS, 'hints').map((r) => r.line), [3]);
  assert.deepEqual(visibleRows(ROWS, 'unknown').map((r) => r.line), [4]);
  assert.deepEqual(visibleRows(null, 'all'), []);
  assert.deepEqual(PREVIEW_FILTERS.map((f) => f.label), ['Alle', 'Hinweise', 'Unbekannt']);
  assert.deepEqual(IMPORT_RULES.map((f) => f.value), ['add', 'replace', 'skip']);
});

test('Übernehmen erst, wenn alle roten Zeilen ausgelassen sind und etwas übrig bleibt', () => {
  assert.equal(canApply(ROWS, new Set()), false);
  assert.equal(canApply(ROWS, new Set([4])), true);
  assert.deepEqual([...omitAllUnknown(ROWS)], [4]);
  assert.equal(canApply([ROWS[2]], new Set([4])), false, 'nur ausgelassene Zeilen');
  assert.equal(canApply(ROWS.map((r) => (r.action === 'import' ? { ...r, action: 'skip-existing' } : r)), new Set([4])), false, 'alles übersprungen');
});

// M4 -- "Nichts zu übernehmen" nur, wenn keine rote Zeile mehr offen ist, aber trotzdem nichts importiert würde
// (Regel "Überspringen" o. Ä.); nicht, solange noch eine rote Zeile aussteht (dort blockiert die, nicht "nichts da").
test('nothingToApply: nur wenn keine rote Zeile offen ist UND keine Zeile importiert würde', () => {
  assert.equal(NOTHING_TO_APPLY, 'Nichts zu übernehmen');
  assert.equal(nothingToApply(ROWS, new Set()), false, 'rote Zeile blockiert noch, ist nicht "nichts da"');
  assert.equal(nothingToApply(ROWS, new Set([4])), false, 'Zeile 2/3 würden importiert');
  const allSkipped = ROWS.map((r) => (r.action === 'import' ? { ...r, action: 'skip-existing' } : r));
  assert.equal(nothingToApply(allSkipped, new Set([4])), true);
  assert.equal(nothingToApply(allSkipped, new Set()), false, 'rote Zeile 4 ist noch offen');
});

// M6 -- Edition als Anzeigename (EDITION_LABELS aus valuation.js, wie CopyChip.jsx); Zustand bleibt der Code, wie im
// Rest der App (CopyChip/CopySheet/BinderView zeigen MT/NM/… ebenfalls unübersetzt).
test('Zeilentext: Edition als Anzeigename, Zustand als Code, unbekannte Edition unverändert', () => {
  assert.equal(rowLabel(ROWS[0]), 'Dunkler Magier · LOB-DE005 · Ultra Rare · DE · 2× · 1. Auflage/NM · Binder Blau · S1 · F3');
  assert.equal(rowLabel(ROWS[1]), '46986414 · LOB-DE005 · Ultra Rare · DE · 1× · Auflage unbekannt/EX · Box');
  assert.equal(rowLabel(ROWS[2]), 'X · LOB-DE005 · Ultra Rare · DE · x/y');
});
