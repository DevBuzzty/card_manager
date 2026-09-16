const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { cmPriceOf, banOf, mergeCards, buildAliases, attachVerified, packCatalog, sealedKindOf, buildSealedProducts } = require('./catalog-build.cjs');

const EN = [{
  id: 46986414, name: 'Dark Magician', type: 'Normal Monster', desc: 'The ultimate wizard.',
  atk: 2500, def: 2100, level: 7, race: 'Spellcaster', attribute: 'DARK',
  card_images: [{ image_url: 'https://x/46986414.jpg', image_url_small: 'https://x/46986414_s.jpg' }],
  card_sets: [{ set_code: 'LOB-EN005', set_rarity: 'Ultra Rare' }, { set_code: 'SDY-006', set_rarity: 'Common' }],
}];
const DE = [{ id: 46986414, name: 'Dunkler Magier', desc: 'Der ultimative Zauberer.' }];

test('mergeCards nimmt den deutschen Namen und Text, behält das englische Gerüst', () => {
  const [c] = mergeCards(EN, DE);
  assert.equal(c.id, 46986414);
  assert.equal(c.name_de, 'Dunkler Magier');
  assert.equal(c.name_en, 'Dark Magician');
  assert.equal(c.desc_de, 'Der ultimative Zauberer.');
  assert.equal(c.atk, 2500);
  assert.equal(c.image, 'https://x/46986414.jpg');
  assert.deepEqual(c.printings, [
    { code: 'LOB-EN005', rarity: 'Ultra Rare' },
    { code: 'SDY-006', rarity: 'Common' },
  ]);
  assert.deepEqual(c.printings_verified, []);
});

test('mergeCards fällt auf Englisch zurück, wenn die Karte im DE-Dump fehlt', () => {
  const [c] = mergeCards(EN, []);
  assert.equal(c.name_de, 'Dark Magician');
  assert.equal(c.desc_de, 'The ultimate wizard.');
});

test('mergeCards überspringt Karten ohne id oder ohne Bild', () => {
  assert.equal(mergeCards([{ name: 'kaputt' }], []).length, 0);
  assert.equal(mergeCards([{ id: 1, name: 'x', card_images: [] }], []).length, 0);
});

test('mergeCards nimmt bei Link-Monstern linkval als Level', () => {
  // YGOPRODeck liefert für Link-Monster kein `level`, sondern `linkval` — ohne den Rückfall
  // landet ein katalogbasierter Scan mit level = null in der Sammlung.
  const LINK = [{
    id: 1861629, name: 'Decode Talker', type: 'Link Monster', desc: 'Ein Link-Monster.',
    atk: 2300, def: null, linkval: 3, race: 'Cyberse', attribute: 'DARK',
    card_images: [{ image_url: 'https://x/1861629.jpg', image_url_small: 'https://x/1861629_s.jpg' }],
    card_sets: [{ set_code: 'YS17-EN043', set_rarity: 'Ultra Rare' }],
  }];
  const [c] = mergeCards(LINK, []);
  assert.equal(c.level, 3);
  // Nicht-Link-Karten behalten ihr echtes Level.
  assert.equal(mergeCards(EN, DE)[0].level, 7);
});

test('mergeCards nimmt linkval auch dann, wenn level als 0 mitgeliefert wird', () => {
  // Der reale Fall, der die erste Fassung überlebt hat: YGOPRODeck schickt für 108 der 473
  // Link-Monster `level: 0` NEBEN einem echten `linkval` (geprüft an 97973962, Aleister the
  // Invoker of Madness: level 0, linkval 2). Ein `c.level ?? c.linkval` lässt die 0 stehen,
  // weil ?? nur auf null/undefined anspricht — die Fallunterscheidung muss über den Typ gehen.
  const LINK0 = [{
    id: 97973962, name: 'Aleister the Invoker of Madness', type: 'Link Monster',
    desc: 'Ein Link-Monster mit level 0 in der Quelle.',
    atk: 1000, def: null, level: 0, linkval: 2, race: 'Spellcaster', attribute: 'DARK',
    card_images: [{ image_url: 'https://x/97973962.jpg', image_url_small: 'https://x/97973962_s.jpg' }],
    card_sets: [{ set_code: 'MP21-EN045', set_rarity: 'Common' }],
  }];
  assert.equal(mergeCards(LINK0, [])[0].level, 2);
});

test('attachVerified hängt nur echte Funde an und leitet nichts ab', () => {
  const merged = mergeCards(EN, DE);
  const out = attachVerified(merged, new Map([
    ['46986414', [{ code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' }]],
  ]));
  assert.deepEqual(out[0].printings_verified, [{ code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' }]);
  // Das englische Printing bleibt unangetastet, es entsteht kein abgeleiteter DE-Code.
  assert.deepEqual(out[0].printings.map(p => p.code), ['LOB-EN005', 'SDY-006']);
});

test('attachVerified lässt eine Karte ohne Fund leer', () => {
  const out = attachVerified(mergeCards(EN, DE), new Map());
  assert.deepEqual(out[0].printings_verified, []);
});

test('packCatalog liefert gültiges gzip mit Version und Karten', () => {
  const { buffer, bytes } = packCatalog(mergeCards(EN, DE), 12);
  const back = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  assert.equal(back.version, 12);
  assert.equal(back.cards.length, 1);
  assert.ok(typeof back.built_at === 'string');
  assert.equal(bytes, buffer.length);
});

test('packCatalog bleibt für einen realistischen Katalog unter 8 MB', () => {
  // 14.500 Karten mit einem 300-Zeichen-Text und 6 Printings — die reale Grössenordnung.
  const desc = 'x'.repeat(300);
  const many = Array.from({ length: 14500 }, (_, i) => ({
    id: 10000000 + i, name: `Karte ${i}`, type: 'Effect Monster', desc,
    atk: 1000, def: 1000, level: 4, race: 'Warrior', attribute: 'EARTH',
    card_images: [{ image_url: `https://x/${i}.jpg`, image_url_small: `https://x/${i}_s.jpg` }],
    card_sets: Array.from({ length: 6 }, (_, k) => ({ set_code: `AB${k}-EN00${k}`, set_rarity: 'Common' })),
  }));
  const { bytes } = packCatalog(mergeCards(many, []), 1);
  assert.ok(bytes <= 8 * 1024 * 1024, `Katalog ist ${(bytes / 1048576).toFixed(2)} MB, Limit 8 MB`);
});

// Spec G3 §3 — Art-Zuordnung aus der Cardmarket-Kategorie. Die neun Kategorien stehen so im echten
// products_nonsingles_3.json (Stand 2026-09-09).
test('sealedKindOf ordnet alle neun Kategorien und Unbekanntes zu', () => {
  const cases = [
    ['Yugioh Display', 'display'],
    ['Yugioh Booster', 'booster'],
    ['Yugioh Collector Tins', 'tin'],
    ['Yugioh Structure Deck', 'deck'],
    ['Yugioh Starter Deck', 'deck'],
    ['Yugioh Special Edition', 'special'],
    ['Yugioh Promo Products', 'other'],
    ['Yugioh Lot', 'other'],
    ['Yugioh Event Tickets', 'other'],
    ['Yugioh Playmat', 'other'],
    [undefined, 'other'],
    ['toString', 'other'],
  ];
  for (const [category, kind] of cases) assert.equal(sealedKindOf(category), kind, String(category));
});

test('buildSealedProducts: Name, Art, Trend nur > 0, doppelte und kaputte Produkte übersprungen', () => {
  const nonsingles = [
    { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 230006, name: 'Force of the Breaker Booster', idCategory: 6, categoryName: 'Yugioh Booster', idExpansion: 1011, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 999001, name: 'Beispiel-Turnierticket', idCategory: 1024, categoryName: 'Yugioh Event Tickets', idExpansion: 0, idMetacard: 0, dateAdded: '2020-01-01 00:00:00' },
    { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 0, name: 'ohne gültige ID', idCategory: 6, categoryName: 'Yugioh Booster' },
    { idProduct: 230007, name: '', idCategory: 6, categoryName: 'Yugioh Booster' },
  ];
  const guide = [
    { idProduct: 254469, idCategory: 42, avg: 6500, low: 465, trend: 499.29 },
    { idProduct: 230006, idCategory: 6, avg: 35, low: 20, trend: 0 },
  ];
  assert.deepEqual(buildSealedProducts(nonsingles, guide), [
    { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 },
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: null },
    { cm_product_id: 999001, name: 'Beispiel-Turnierticket', kind: 'other', trend: null },
  ]);
  assert.deepEqual(buildSealedProducts(null, null), []);
});

test('packCatalog schreibt sealed_products, ohne Angabe leer', () => {
  const plain = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 12).buffer).toString('utf8'));
  assert.deepEqual(plain.sealed_products, []);
  const products = [{ cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 }];
  const withSealed = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 13, products).buffer).toString('utf8'));
  assert.deepEqual(withSealed.sealed_products, products);
  assert.equal(withSealed.cards.length, 1);
});

// Spec E1 §5 — cm_price aus card_prices[0].cardmarket_price; 0 oder fehlend wird null. Katalog Version 6.
test('cmPriceOf liest den Cardmarket-Preis, 0/leer/fehlend wird null', () => {
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '4.50', tcgplayer_price: '9.99' }] }), 4.5);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: 12.5 }] }), 12.5);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '0.00' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: 'n/a' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{}] }), null);
  assert.equal(cmPriceOf({ card_prices: [] }), null);
  assert.equal(cmPriceOf({}), null);
});

test('mergeCards schreibt cm_price, der gepackte Katalog Version 6 trägt ihn', () => {
  const withPrice = [{ ...EN[0], card_prices: [{ cardmarket_price: '35.71' }] }];
  assert.equal(mergeCards(withPrice, DE)[0].cm_price, 35.71);
  assert.equal(mergeCards(EN, DE)[0].cm_price, null, 'EN ohne card_prices');
  const back = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(withPrice, DE), 6).buffer).toString('utf8'));
  assert.equal(back.version, 6);
  assert.equal(back.cards[0].cm_price, 35.71);
});

// Spec E3 §3 -- Banlist aus banlist_info. Echte Werte im YGOPRODeck-Dump: "Forbidden", "Limited", "Semi-Limited".
test('banOf: Forbidden/Banned -> forbidden, Limited -> limited, Semi-Limited -> semi, sonst null', () => {
  const c = { banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Semi-Limited', ban_goat: 'Limited' } };
  assert.equal(banOf(c, 'ban_tcg'), 'forbidden');
  assert.equal(banOf(c, 'ban_ocg'), 'semi');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Banned' } }, 'ban_tcg'), 'forbidden');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Limited' } }, 'ban_tcg'), 'limited');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Limited' } }, 'ban_ocg'), null, 'Schlüssel fehlt');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Unlimited' } }, 'ban_tcg'), null, 'unbekannter Wert');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'toString' } }, 'ban_tcg'), null);
  assert.equal(banOf({}, 'ban_tcg'), null, 'banlist_info fehlt');
});

test('mergeCards schreibt ban_tcg und ban_ocg, ohne banlist_info null', () => {
  const pot = [{ ...EN[0], id: 55144522, name: 'Pot of Greed', banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Limited', ban_goat: 'Limited' } }];
  const [c] = mergeCards(pot, []);
  assert.equal(c.ban_tcg, 'forbidden');
  assert.equal(c.ban_ocg, 'limited');
  const [plain] = mergeCards(EN, DE);
  assert.equal(plain.ban_tcg, null);
  assert.equal(plain.ban_ocg, null);
});

test('buildAliases: alle abweichenden card_images[].id, Haupt-ID nie, nur Karten im Katalog', () => {
  const en = [
    { ...EN[0], card_images: [{ id: 46986414, image_url: 'a' }, { id: 46986415, image_url: 'b' }, { id: 36996508, image_url: 'c' }] },
    { id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', card_images: [{ id: 89631139, image_url: 'd' }, { id: 89631140, image_url: 'e' }] },
    { id: 12345678, name: 'ohne Bild', card_images: [{ id: 12345679 }] },
  ];
  const cards = mergeCards(en, []);
  assert.deepEqual(buildAliases(en, cards), { 46986415: '46986414', 36996508: '46986414', 89631140: '89631139' });
  assert.deepEqual(buildAliases(en, cards.filter((c) => c.id !== 89631139)), { 46986415: '46986414', 36996508: '46986414' });
});

test('buildAliases: eine Artwork-ID, die selbst Haupt-ID ist, wird nicht umgebogen', () => {
  const en = [
    { id: 1, name: 'A', card_images: [{ id: 1, image_url: 'a' }, { id: 2, image_url: 'b' }] },
    { id: 2, name: 'B', card_images: [{ id: 2, image_url: 'b' }] },
  ];
  assert.deepEqual(buildAliases(en, mergeCards(en, [])), {});
});

test('packCatalog schreibt aliases, ohne Angabe leer', () => {
  const plain = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 14).buffer).toString('utf8'));
  assert.deepEqual(plain.aliases, {});
  const withAliases = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 15, [], { 46986415: '46986414' }).buffer).toString('utf8'));
  assert.deepEqual(withAliases.aliases, { 46986415: '46986414' });
});
