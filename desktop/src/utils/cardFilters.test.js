import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, matchesPreset } from './cardFilters.js';

// ZWILLING: android CardFilterPresetsTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/filter-presets.json', import.meta.url), 'utf8'));

test('Die Voreinstellungen heissen wie in der Fixture', () => {
  assert.deepEqual(PRESETS.map(p => [p.id, p.label]), F.presets);
});

test('Jeder Fixture-Fall trifft die erwartete Voreinstellung', () => {
  for (const c of F.faelle) {
    assert.equal(matchesPreset(c.karte, 'unvollstaendig'), c.unvollstaendig, `${c.name}: unvollstaendig`);
    assert.equal(matchesPreset(c.karte, 'foils'), c.foils, `${c.name}: foils`);
  }
});

test('Unbekannte Voreinstellung trifft nichts', () => {
  assert.equal(matchesPreset(F.faelle[0].karte, 'quatsch'), false);
});
