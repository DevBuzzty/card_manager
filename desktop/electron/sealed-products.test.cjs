const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSealedProducts, sealedProductsForCatalog, searchSealedProducts } = require('./sealed-products.cjs');

// Echte Zeilen aus dem Cardmarket-Cache (products_nonsingles_3.json vom 2026-09-09, price_guide_3.json vom 2026-09-14).
const PRODUCTS = [
  { idProduct: 254470, name: 'Spell Ruler Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1250, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
  { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
  { idProduct: 230006, name: 'Force of the Breaker Booster', idCategory: 6, categoryName: 'Yugioh Booster', idExpansion: 1011, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
];
const GUIDES = [
  { idProduct: 254470, idCategory: 42, avg: null, low: 1200, trend: 97.05 },
  { idProduct: 254469, idCategory: 42, avg: 6500, low: 465, trend: 499.29 },
  { idProduct: 230006, idCategory: 6, avg: 35, low: 20, trend: 34.22 },
];

// Jeder Test bekommt ein eigenes userData-Verzeichnis (der Modul-Cache ist nach Verzeichnis geschluesselt).
function userData(withCache) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-sealed-'));
  if (withCache) {
    fs.mkdirSync(path.join(dir, 'cardmarket'));
    fs.writeFileSync(path.join(dir, 'cardmarket', 'products_nonsingles_3.json'),
      JSON.stringify({ version: 1, createdAt: '2026-09-09T12:40:29+0200', products: PRODUCTS }));
    fs.writeFileSync(path.join(dir, 'cardmarket', 'price_guide_3.json'),
      JSON.stringify({ version: 1, createdAt: '2026-09-14T21:19:43+0200', priceGuides: GUIDES }));
  }
  return dir;
}

test('ohne Cardmarket-Cache: keine Produktliste, der Katalog bekommt []', () => {
  const dir = userData(false);
  assert.equal(readSealedProducts(dir), null);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), []);
  assert.deepStrictEqual(sealedProductsForCatalog(null), []);
});

test('unlesbarer Price-Guide: keine Produktliste', () => {
  const dir = userData(true);
  fs.writeFileSync(path.join(dir, 'cardmarket', 'price_guide_3.json'), '{ kaputt');
  assert.equal(readSealedProducts(dir), null);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), []);
});

test('Produktliste aus dem Cache mit Art und Trend', () => {
  const dir = userData(true);
  const expected = [
    { cm_product_id: 254470, name: 'Spell Ruler Booster Box', kind: 'display', trend: 97.05 },
    { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 },
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22 },
  ];
  assert.deepStrictEqual(readSealedProducts(dir), expected);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), expected);
});

test('Suche: Teilstring ohne Groß-/Kleinschreibung, nach Name sortiert, höchstens limit, mit kindLabel', () => {
  const products = readSealedProducts(userData(true));
  assert.deepStrictEqual(searchSealedProducts(products, 'booster box').map((p) => p.name),
    ['Metal Raiders Booster Box', 'Spell Ruler Booster Box']);
  assert.deepStrictEqual(searchSealedProducts(products, 'BOOSTER', 1).map((p) => p.name), ['Force of the Breaker Booster']);
  assert.deepStrictEqual(searchSealedProducts(products, 'force'), [
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22, kindLabel: 'Booster' },
  ]);
  assert.deepStrictEqual(searchSealedProducts(products, '   '), []);
  assert.deepStrictEqual(searchSealedProducts(products, '100%'), []);
});
