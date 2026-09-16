const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards } = require('./catalog-prices.cjs');

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

// Spec E2 §4 -- Katalog-Index fuer den Import aus derselben Datei.
test('Katalog-Index: mit ids nur diese samt Bild, ohne ids alle kompakt ohne Bild', () => {
  const dir = tmpDir();
  saveCatalogFile(dir, packCatalog(mergeCards([card(14558127, '4.50'), card(1861629)], [{ id: 14558127, name: 'Asche-Blüte', desc: 'x' }]), 7).buffer);
  assert.deepEqual(catalogCards(dir, ['14558127', '99999999', 14558127]), {
    available: true,
    cards: [{ id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster', image: 'https://x/14558127.jpg' }],
  });
  assert.deepEqual(catalogCards(dir), {
    available: true,
    cards: [
      { id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster' },
      { id: '1861629', name_de: 'Karte 1861629', name_en: 'Karte 1861629', type: 'Effect Monster' },
    ],
  });
  assert.equal(readCatalogCards(dir).get('1861629').image, 'https://x/1861629.jpg');
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '14558127': 4.5, '1861629': null } }, 'Preise unverändert');
});

test('Katalog-Index ohne Datei: Katalog fehlt', () => {
  assert.deepEqual(catalogCards(tmpDir(), ['14558127']), { available: false, cards: [] });
  assert.equal(readCatalogCards(tmpDir()), null);
});
