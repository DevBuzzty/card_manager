import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, matchesPreset, matchesPresetGroup } from './cardFilters.js';

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

// Fixrunde 1: eine Kachel buendelt mehrere Drucke -- sie muss treffen, wenn IRGENDEIN Druck trifft,
// nicht nur der zuerst angetroffene (das war der Bug: matchesPreset direkt auf die Kachel angewendet).
test('Jede Gruppe trifft die erwartete Voreinstellung ueber alle Drucke', () => {
  for (const g of F.gruppen) {
    assert.equal(matchesPresetGroup(g.drucke, 'unvollstaendig'), g.unvollstaendig, `${g.name}: unvollstaendig`);
    assert.equal(matchesPresetGroup(g.drucke, 'foils'), g.foils, `${g.name}: foils`);
  }
});
