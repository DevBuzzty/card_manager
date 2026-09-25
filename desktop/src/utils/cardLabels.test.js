import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATTRIBUTE_LABELS, RACE_LABELS, attributeLabel, raceLabel, typeGroup } from './cardLabels.js';

// ZWILLING: android CardLabelsTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/valuation/card-labels.json', import.meta.url), 'utf8'));

test('Kartenart-Gruppen (Fixture)', () => {
  for (const c of F.typeGroups) assert.equal(typeGroup(c.type), c.group, String(c.type));
});

test('Attribute und Monstertypen deutsch, Unbekanntes bleibt (Fixture)', () => {
  assert.deepEqual(ATTRIBUTE_LABELS, F.attributes);
  assert.deepEqual(RACE_LABELS, F.races);
  for (const [en, de] of Object.entries(F.attributes)) assert.equal(attributeLabel(en), de);
  for (const [en, de] of Object.entries(F.races)) assert.equal(raceLabel(en), de);
  for (const x of F.passThrough) { assert.equal(attributeLabel(x), x); assert.equal(raceLabel(x), x); }
});
