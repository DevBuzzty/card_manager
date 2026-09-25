import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveText, selectionCopies, selectionText, sellSubtitle } from './selection.js';

// ZWILLING: android SelectionTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/copies/selection.json', import.meta.url), 'utf8'));

test('Exemplare der Auswahl (Fixture)', () => {
  for (const c of F.cases) {
    assert.deepEqual(selectionCopies(F.groups, c.selected, F.copies, c.containers).map((x) => x.copy_id), c.copyIds, c.name);
  }
});

test('Texte der Auswahl-Leiste, des Verkaufswegs und des Verschiebens (Fixture)', () => {
  for (const c of F.selectionTexts) assert.equal(selectionText(c.cards, c.copies), c.text);
  for (const c of F.sellSubtitles) assert.equal(sellSubtitle(c.cards, c.copies), c.text);
  for (const c of F.moveTexts) assert.equal(moveText(c.count, c.target), c.text);
});
