import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLOR_PRESETS, DEFAULT_COLOR } from './containerColors.js';

// ZWILLING: android ContainerColorsTest.kt liest dieselbe Datei (Abschlussreview B10).
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/container-colors.json', import.meta.url), 'utf8'));

test('Behaelter-Farbvoreinstellungen stimmen mit der Fixture ueberein (Reihenfolge zaehlt)', () => {
  assert.deepEqual(COLOR_PRESETS.map(h => h.toUpperCase()), FIX.presets);
});

test('Vorgabefarbe eines neuen Behaelters ist die der Fixture', () => {
  assert.equal(DEFAULT_COLOR.toUpperCase(), FIX.default);
  assert.ok(FIX.presets.includes(FIX.default), 'Vorgabe ist eine der Voreinstellungen');
});
