import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  marketValueCents, netCents, feeDefaultCents, suggestionCents,
  normalizeDiscount, normalizeMinPrice, diffText, euroCentsText, saleListValues,
} from './saleMath.js';

// ZWILLING: desktop/electron/sales-math.test.cjs und android SalesMathTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/sales/sales.json', import.meta.url), 'utf8'));
const S = FIX.stats;
const soldInOf = (id) => (id in S.soldIn ? S.soldIn[id] : null);

test('Marktwert je Exemplar in Cent', () => {
  for (const c of FIX.marketValue) assert.equal(marketValueCents(c.card, c.copy), c.cents, c.name);
});
test('Netto = Preis − Gebühren − Versand', () => {
  for (const c of FIX.net) assert.equal(netCents(c.sale), c.cents, JSON.stringify(c.sale));
});
test('Gebühren-Vorbelegung', () => {
  for (const c of FIX.feeDefault) assert.equal(feeDefaultCents(c.grossCents, c.percent), c.cents, JSON.stringify(c));
});
test('Preisvorschlag', () => {
  for (const c of FIX.suggestion) assert.equal(suggestionCents(c.value, c.discount, c.min), c.cents, c.name);
});
test('Einstellungen normalisieren', () => {
  for (const c of FIX.normalize.discount) assert.equal(normalizeDiscount(c.raw), c.out, JSON.stringify(c.raw));
  for (const c of FIX.normalize.minPrice) assert.equal(normalizeMinPrice(c.raw), c.out, JSON.stringify(c.raw));
});
test('Texte', () => {
  for (const c of FIX.texts) assert.equal(diffText(c.net, c.market), c.diff);
  for (const c of FIX.euro) assert.equal(euroCentsText(c.cents), c.text);
});
test('Verkaufsliste je Zeile (Storno ohne sold_in-Pruefung, Doppelverkauf ausgeblendet)', () => {
  for (const c of S.listValues) {
    const sale = S.sales.find((s) => s.sale_id === c.sale_id);
    assert.deepEqual(saleListValues(sale, S.items, soldInOf), { netCents: c.netCents, marketCents: c.marketCents }, c.sale_id);
  }
});
