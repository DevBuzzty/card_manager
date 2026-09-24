import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyRow, UNSORTED_TEXT } from './copyRow.js';
import { EDITION_LABELS } from './valuation.js';

// ZWILLING: android CopyRowTextTest.kt liest dieselbe Fixture. Spec I §4.1.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/copies/copy-row.json', import.meta.url), 'utf8'));

test('Auflage-Beschriftungen der App sind die der Fixture', () => {
  assert.deepEqual(EDITION_LABELS, F.editionen);
  assert.equal(UNSORTED_TEXT, F.ohneBehaelter);
});

test('Jeder Fixture-Fall ergibt dieselbe Zeile', () => {
  for (const c of F.faelle) {
    const offers = Array.from({ length: c.angebote }, (_, i) => ({ listing_id: `l${i}` }));
    const r = copyRow(c.copy, c.container, offers);
    assert.deepEqual(r, { lead: c.lead, location: c.location, unsorted: c.unsorted, marks: c.marks }, c.name);
  }
});

test('Kein Text "ohne Standort" mehr', () => {
  for (const c of F.faelle) assert.ok(!copyRow(c.copy, c.container, []).location.includes('ohne Standort'), c.name);
});
