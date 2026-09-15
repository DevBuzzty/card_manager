const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pickSealedUpdates, trendById } = require('./sealed-prices.cjs');

// ZWILLING: supabase/functions/refresh-cardmarket-prices/sealed_test.ts liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'sealed-prices.json'), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepStrictEqual(pickSealedUpdates(c.items, c.guide), c.expected);
  });
}

test('trendById nimmt nur positive Zahlen', () => {
  const m = trendById([{ idProduct: 1, trend: 0 }, { idProduct: 1, trend: 2.5 }, { idProduct: 2, trend: -1 }, { idProduct: 3, trend: NaN }]);
  assert.deepStrictEqual([...m.entries()], [[1, 2.5]]);
});
