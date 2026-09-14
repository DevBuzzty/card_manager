const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { computeMovers, familyOfSource, familyOfLock, addDays } = require('./movers.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/MoversTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'movers.json'), 'utf8'));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const pick = (m) => ({ key: m.key, oldPrice: m.oldPrice, newPrice: m.newPrice, deltaUnit: m.deltaUnit, pct: m.pct, weight: m.weight, copies: m.copies, deltaHolding: m.deltaHolding });

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const r = computeMovers(c.input);
    assert.equal(r.status, c.expected.status);
    assert.equal(r.firstDay, c.expected.firstDay);
    for (const list of ['winners', 'losers']) {
      assert.equal(r[list].length, c.expected[list].length, list);
      r[list].forEach((m, i) => {
        const e = c.expected[list][i];
        const got = pick(m);
        assert.equal(got.key, e.key, `${list}[${i}].key`);
        assert.equal(got.copies, e.copies, `${list}[${i}].copies`);
        for (const f of ['oldPrice', 'newPrice', 'deltaUnit', 'pct', 'weight', 'deltaHolding']) near(got[f], e[f], `${list}[${i}].${f}`);
      });
    }
  });
}

test('Familien: Quelle und Sperre', () => {
  assert.equal(familyOfSource('cm_bulk'), 'cm');
  assert.equal(familyOfSource('cloud'), 'cm');
  assert.equal(familyOfSource('ygoprodeck'), 'ygo');
  assert.equal(familyOfSource('irgendwas'), 'unknown');
  assert.equal(familyOfLock(null), 'ygo');
  assert.equal(familyOfLock(1), 'cm');
  assert.equal(familyOfLock(2), 'manual');
  assert.equal(familyOfLock(7), 'unknown');
});

test('addDays rechnet in UTC ueber Monatsgrenzen', () => {
  assert.equal(addDays('2026-09-20', -30), '2026-08-21');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
