const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sealedValue, isPriceStale, kindLabel, sortSealed, SEALED_KINDS } = require('./sealed-value.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/SealedValueTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'sealed-value.json'), 'utf8'));

test('Sealed-Wert', () => {
  for (const c of FIX.value) {
    const v = sealedValue(c.items);
    assert.ok(Math.abs(v - c.value) < 1e-9, `${c.name}: ${v} statt ${c.value}`);
  }
});

test('Preis veraltet', () => {
  const now = Date.parse(FIX.now);
  for (const c of FIX.stale) assert.equal(isPriceStale(c.price_updated_at, now), c.stale, c.name);
});

test('Art-Bezeichnungen', () => {
  for (const c of FIX.kinds) assert.equal(kindLabel(c.kind), c.label, String(c.kind));
  assert.deepStrictEqual(SEALED_KINDS, ['display', 'booster', 'tin', 'deck', 'special', 'other']);
});

test('Reihenfolge der Liste', () => {
  for (const c of FIX.order) {
    const before = c.items.map((i) => i.sealed_id);
    assert.deepStrictEqual(sortSealed(c.items).map((i) => i.sealed_id), c.expected, c.name);
    assert.deepStrictEqual(c.items.map((i) => i.sealed_id), before, 'sortSealed darf die Eingabe nicht umsortieren');
  }
});
