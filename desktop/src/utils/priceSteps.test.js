import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSteps, familyOfSource, addDaysUtc, fmtDayDE, todayUtc } from './priceSteps.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/PriceStepsTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/portfolio/price-steps.json', import.meta.url), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepEqual(computeSteps(c.rows, c.today, c.window), c.expected);
  });
}

test('Hilfen: Familie, Tage, Kurzdatum, heute', () => {
  assert.equal(familyOfSource('cm_scrape'), 'cm');
  assert.equal(familyOfSource(undefined), 'unknown');
  assert.equal(addDaysUtc('2026-03-01', -1), '2026-02-28');
  assert.equal(fmtDayDE('2026-09-23'), '23.09.');
  assert.equal(todayUtc(new Date('2026-09-20T23:30:00-02:00')), '2026-09-21');
});
