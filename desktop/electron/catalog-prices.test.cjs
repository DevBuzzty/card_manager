const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices } = require('./catalog-prices.cjs');

const card = (id, cardmarket_price) => ({
  id, name: `Karte ${id}`, type: 'Effect Monster', desc: 'd',
  card_images: [{ image_url: `https://x/${id}.jpg` }],
  card_prices: cardmarket_price === undefined ? undefined : [{ cardmarket_price }],
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-prices-'));

test('ohne Katalogdatei: nicht verfügbar, alle Preise unbekannt', () => {
  const dir = tmpDir();
  assert.equal(readCatalogPrices(dir), null);
  assert.deepEqual(catalogPrices(dir), { available: false, prices: {} });
});

test('liest cm_price aus der gespeicherten Katalogdatei (Version 6)', () => {
  const dir = tmpDir();
  saveCatalogFile(dir, packCatalog(mergeCards([card(14558127, '4.50'), card(10045474, '0.00')], []), 6).buffer);
  assert.ok(fs.existsSync(catalogFilePath(dir)));
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '14558127': 4.5, '10045474': null } });
});

test('ein Katalog von vor Version 6 bleibt lesbar, Preise null', () => {
  const dir = tmpDir();
  const v5 = { version: 5, built_at: 'x', cards: [{ id: 23434538, name_de: 'Maxx "C"', image: 'i' }], sealed_products: [] };
  saveCatalogFile(dir, require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v5))));
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '23434538': null } });
});
