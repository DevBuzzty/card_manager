const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const {
  catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards, catalogMainId, catalogLegality,
} = require('./catalog-prices.cjs');

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
    aliases: {},
  });
  assert.deepEqual(catalogCards(dir), {
    available: true,
    cards: [
      { id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster' },
      { id: '1861629', name_de: 'Karte 1861629', name_en: 'Karte 1861629', type: 'Effect Monster' },
    ],
    aliases: {},
  });
  assert.equal(readCatalogCards(dir).get('1861629').image, 'https://x/1861629.jpg');
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '14558127': 4.5, '1861629': null } }, 'Preise unverändert');
});

test('Katalog-Index ohne Datei: Katalog fehlt', () => {
  assert.deepEqual(catalogCards(tmpDir(), ['14558127']), { available: false, cards: [], aliases: {} });
  assert.equal(readCatalogCards(tmpDir()), null);
});

// Spec E3 §3/§4 -- Artwork-Zuordnung, Banlist und Baudatum aus derselben Datei.
const banned = (id, name, type, banlist_info) => ({ ...card(id), name, type, banlist_info });

function saveE3Catalog(dir) {
  const en = [
    banned(46986414, 'Dark Magician', 'Normal Monster'),
    banned(55144522, 'Pot of Greed', 'Spell Card', { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden' }),
    banned(18144506, "Harpie's Feather Duster", 'Spell Card', { ban_tcg: 'Limited', ban_ocg: 'Semi-Limited' }),
  ];
  const cards = mergeCards(en, [{ id: 46986414, name: 'Dunkler Magier', desc: 'x' }]);
  saveCatalogFile(dir, packCatalog(cards, 8, [], { 46986415: '46986414', 99999998: '11111111' }).buffer);
}

test('Katalog-Index löst Artwork-Passcodes über die Zuordnung auf (Hauptkarte, aliases je Anfrage)', () => {
  const dir = tmpDir();
  saveE3Catalog(dir);
  assert.deepEqual(catalogCards(dir, ['46986415', '46986414', '99999998']), {
    available: true,
    cards: [{ id: '46986414', name_de: 'Dunkler Magier', name_en: 'Dark Magician', type: 'Normal Monster', image: 'https://x/46986414.jpg' }],
    aliases: { 46986415: '46986414' },
  });
  assert.equal(catalogMainId(dir, '46986415'), '46986414');
  assert.equal(catalogMainId(dir, 46986414), '46986414');
  assert.equal(catalogMainId(dir, '99999998'), '99999998', 'Zuordnung auf eine Karte außerhalb des Katalogs zählt nicht');
  assert.equal(catalogMainId(tmpDir(), '46986415'), '46986415', 'ohne Datei unverändert');
});

test('Legalitäts-Index: Name, Typ, Banlist, ganze Zuordnung und Baudatum', () => {
  const dir = tmpDir();
  saveE3Catalog(dir);
  const leg = catalogLegality(dir);
  assert.equal(leg.available, true);
  assert.match(leg.builtAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(leg.aliases, { 46986415: '46986414' });
  assert.deepEqual(leg.cards, {
    46986414: { name: 'Dunkler Magier', type: 'Normal Monster', ban_tcg: null, ban_ocg: null },
    55144522: { name: 'Pot of Greed', type: 'Spell Card', ban_tcg: 'forbidden', ban_ocg: 'forbidden' },
    18144506: { name: "Harpie's Feather Duster", type: 'Spell Card', ban_tcg: 'limited', ban_ocg: 'semi' },
  });
  assert.equal(catalogLegality(dir), leg, 'einmal je Datei gebaut');
});

test('Legalitäts-Index: ohne Datei oder mit Katalog von vor E3 (ohne aliases) nicht verfügbar', () => {
  const empty = { available: false, builtAt: null, aliases: {}, cards: {} };
  assert.deepEqual(catalogLegality(tmpDir()), empty);
  const dir = tmpDir();
  const v7 = { version: 7, built_at: '2026-09-10T03:00:00.000Z', cards: [{ id: 55144522, name_de: 'Topf der Gier', type: 'Spell Card', image: 'i' }], sealed_products: [] };
  saveCatalogFile(dir, require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v7))));
  assert.deepEqual(catalogLegality(dir), empty);
  assert.equal(catalogCards(dir, ['55144522']).cards.length, 1, 'Import liest den alten Katalog weiter');
});
