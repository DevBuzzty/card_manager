import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTarget, parsePct, parseMinEur, toInput } from './alertInput.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/AlertInputTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/portfolio/alert-input.json', import.meta.url), 'utf8'));

const check = (fn, cases) => {
  for (const c of cases) assert.deepEqual(fn(c.in), { value: c.value, error: c.error }, JSON.stringify(c.in));
};

test('Zielpreis', () => check(parseTarget, FIX.target));
test('Prozent', () => check(parsePct, FIX.pct));
test('Mindestbetrag', () => check(parseMinEur, FIX.minEur));
test('Anzeige im Feld', () => {
  for (const c of FIX.toInput) assert.equal(toInput(c.in), c.out);
});
