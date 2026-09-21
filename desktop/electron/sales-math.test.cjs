const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('./sales-math.cjs');

// ZWILLING: desktop/src/utils/saleMath.test.js und android SalesMathTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/sales/sales.json'), 'utf8'));
const S = FIX.stats;
const soldInOf = (id) => (id in S.soldIn ? S.soldIn[id] : null);

test('Marktwert je Exemplar in Cent', () => {
  for (const c of FIX.marketValue) assert.equal(M.marketValueCents(c.card, c.copy), c.cents, c.name);
});
test('Netto = Preis − Gebühren − Versand', () => {
  for (const c of FIX.net) assert.equal(M.netCents(c.sale), c.cents, JSON.stringify(c.sale));
});
test('Gebühren-Vorbelegung', () => {
  for (const c of FIX.feeDefault) assert.equal(M.feeDefaultCents(c.grossCents, c.percent), c.cents, JSON.stringify(c));
});
test('Verteilung mit Rest-Cent', () => {
  for (const c of FIX.distribute) {
    const s = M.distribute(c.net, c.values);
    assert.deepEqual(s, c.shares, c.name);
    assert.equal(s.reduce((a, b) => a + b, 0), c.net, `${c.name}: Summe`);
  }
});
test('Preisvorschlag', () => {
  for (const c of FIX.suggestion) assert.equal(M.suggestionCents(c.value, c.discount, c.min), c.cents, c.name);
});
test('Einstellungen normalisieren', () => {
  for (const c of FIX.normalize.discount) assert.equal(M.normalizeDiscount(c.raw), c.out, JSON.stringify(c.raw));
  for (const c of FIX.normalize.minPrice) assert.equal(M.normalizeMinPrice(c.raw), c.out, JSON.stringify(c.raw));
});
test('Texte', () => {
  for (const c of FIX.texts) assert.equal(M.diffText(c.net, c.market), c.diff);
  for (const c of FIX.euro) assert.equal(M.euroCentsText(c.cents), c.text);
});
test('Doppelverkauf', () => {
  assert.deepEqual([...M.doubleSold(S.sales, S.items)].sort(), S.doubleSold);
});
test('Verkaufsliste je Zeile (Storno ohne sold_in-Pruefung, Doppelverkauf ausgeblendet)', () => {
  for (const c of S.listValues) {
    const sale = S.sales.find((s) => s.sale_id === c.sale_id);
    assert.deepEqual(M.saleListValues(sale, S.items, soldInOf), { netCents: c.netCents, marketCents: c.marketCents }, c.sale_id);
  }
});
test('Kennzahlen je Zeitraum', () => {
  for (const p of ['monat', 'jahr', 'gesamt']) {
    const sales = M.periodFilter(S.sales, p, S.today);
    assert.deepEqual(M.saleTotals(sales, S.items, soldInOf), S.periods[p], p);
  }
});
test('Je Kanal (gesamt)', () => {
  assert.deepEqual(M.byChannel(M.periodFilter(S.sales, 'gesamt', S.today), S.items, soldInOf), S.byChannelGesamt);
});
test('Je Monat', () => {
  assert.deepEqual(M.byMonth(S.sales, S.items, soldInOf, S.today, 3), S.byMonthLast3);
});
test('Verteilung: Summe exakt auch bei vielen Positionen', () => {
  const values = Array.from({ length: 37 }, (_, i) => (i * 37) % 101);
  for (const net of [1, 999, -1234, 100000]) assert.equal(M.distribute(net, values).reduce((a, b) => a + b, 0), net);
});
