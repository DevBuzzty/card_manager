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

const { attachCm } = require('./catalog-build.cjs');

test('attachCm setzt cm an printings und printings_verified, uebergibt die Seltenheiten des Set-Kuerzels', () => {
  const cards = [{
    id: '1', name_en: 'Toadally Awesome',
    printings: [{ code: 'RA03-EN040', rarity: 'Super Rare' }, { code: 'RA03-EN040', rarity: 'Ultra Rare' }, { code: 'SHVI-EN032', rarity: 'Secret Rare' }],
    printings_verified: [{ code: 'RA03-DE040', rarity: 'Ultra Rare', lang: 'DE' }],
  }];
  const calls = [];
  const lookup = (name, code, rarity, rars) => {
    calls.push([name, code, rarity, rars]);
    if (code.startsWith('SHVI')) return null;
    return rarity === 'Ultra Rare' ? 30 : [20, 30];
  };
  attachCm(cards, lookup);
  assert.deepEqual(cards[0].printings[0].cm, [20, 30]);
  assert.equal(cards[0].printings[1].cm, 30);
  assert.equal('cm' in cards[0].printings[2], false);           // null -> Feld fehlt
  assert.equal(cards[0].printings_verified[0].cm, 30);
  assert.deepEqual(calls[3], ['Toadally Awesome', 'RA03-DE040', 'Ultra Rare', ['Super Rare', 'Ultra Rare']]);
});

// ---- Nachtrag Katalogbau 2026-11-03: verifizierte Drucke aus dem Vorgaenger-Katalog erhalten ----
const { mergeVerified, isGermanCode } = require('./catalog-build.cjs');

// Form wie im veroeffentlichten Katalog v11: Eintraege tragen `cm` (von attachCm), lang 'DE'.
const PREV = {
  version: 11,
  cards: [
    { id: 46986414, printings_verified: [
      { code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE', cm: [1, 2] },
      { code: 'SDY-DE006', rarity: 'Common', lang: 'DE' },
    ] },
    { id: 89631139, printings_verified: [
      { code: 'SDK-G001', rarity: 'Ultra Rare', lang: 'DE', cm: 7 },
      { code: 'LCKC-DE001', rarity: 'Unknown', lang: 'DE' },
    ] },
    { id: 11111111, printings_verified: [] },
  ],
};

test('mergeVerified ohne lokale Funde uebernimmt den Vorgaenger verlustfrei (ohne cm, gleiche Reihenfolge)', () => {
  const { verified, carriedCards, carriedPrintings } = mergeVerified(new Map(), PREV);
  assert.deepEqual([...verified.keys()], ['46986414', '89631139']);
  assert.deepEqual(verified.get('46986414'), [
    { code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' },
    { code: 'SDY-DE006', rarity: 'Common', lang: 'DE' },
  ]);
  assert.deepEqual(verified.get('89631139'), [
    { code: 'SDK-G001', rarity: 'Ultra Rare', lang: 'DE' },
    { code: 'LCKC-DE001', rarity: 'Unknown', lang: 'DE' },
  ]);
  assert.equal(carriedCards, 2);
  assert.equal(carriedPrintings, 4);
});

test('mergeVerified: kennt der lokale Cache eine Karte, ersetzt er den Vorgaenger fuer diese Karte ganz', () => {
  const local = new Map([
    ['46986414', [
      { code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' },
      { code: 'LOB-DE005', rarity: 'Secret Rare', lang: 'DE' },         // neu lokal
    ]],                                                                    // SDY-DE006 hat Yugipedia nicht mehr
    ['22222222', [{ code: 'NEU-DE001', rarity: 'Common', lang: 'DE' }]],
  ]);
  const { verified, carriedCards, carriedPrintings } = mergeVerified(local, PREV);
  assert.deepEqual(verified.get('46986414'), [
    { code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' },
    { code: 'LOB-DE005', rarity: 'Secret Rare', lang: 'DE' },
  ]);
  assert.deepEqual(verified.get('22222222'), [{ code: 'NEU-DE001', rarity: 'Common', lang: 'DE' }]);
  assert.equal(verified.get('89631139').length, 2);
  // uebernommen wird nur fuer Karten ohne lokalen Fund: 89631139 (2 Drucke)
  assert.equal(carriedCards, 1);
  assert.equal(carriedPrintings, 2);
});

test('mergeVerified: ein korrigierter lokaler Cache entfernt alte Fehleintraege des Vorgaengers', () => {
  const prev = { cards: [{ id: 74677422, printings_verified: [
    { code: 'LOB-DE070', rarity: 'Ultra Rare-->', lang: 'DE' },
    { code: 'LOB-DE999', rarity: 'Ultra Rare', lang: 'DE' },            // von Yugipedia inzwischen entfernt
  ] }] };
  const local = new Map([['74677422', [{ code: 'LOB-DE070', rarity: 'Ultra Rare', lang: 'DE' }]]]);
  const { verified, carriedCards } = mergeVerified(local, prev);
  assert.deepEqual(verified.get('74677422'), [{ code: 'LOB-DE070', rarity: 'Ultra Rare', lang: 'DE' }]);
  assert.equal(carriedCards, 0);
});

test('mergeVerified: Kommentar-/Template-Reste in der Rarity werden entfernt (Faelle aus v11)', () => {
  // Polymerization 24094653 und Red-Eyes 74677422 wie in Katalog v11
  const prev = { cards: [
    { id: 24094653, printings_verified: [
      { code: 'SGX2-DEA12', rarity: 'Common<!--', lang: 'DE' },
      { code: 'JUSH-DE014', rarity: 'Rare-->', lang: 'DE' },
      { code: 'SGX2-DEA12', rarity: 'Common', lang: 'DE' },
      { code: 'JUSH-DE014', rarity: 'Rare', lang: 'DE' },
      { code: 'ABC-DE001', rarity: '<!-- Secret Rare -->Super Rare', lang: 'DE' },
      { code: 'ABC-DE002', rarity: 'Rare{{Sup|x}}', lang: 'DE' },
      { code: 'ABC-DE003', rarity: 'Ultra Rare|egal', lang: 'DE' },
      { code: 'ABC-DE004', rarity: '<!--', lang: 'DE' },                  // nur Rest -> Code bleibt, Rarity unbekannt
      { code: 'ABC-DE005', rarity: '3', lang: 'DE' },                     // keine Rarity (kenntRarity)
    ] },
    { id: 74677422, printings_verified: [{ code: 'LOB-DE070', rarity: 'Ultra Rare-->', lang: 'DE' }] },
  ] };
  const { verified, carriedPrintings } = mergeVerified(new Map(), prev);
  assert.deepEqual(verified.get('24094653').map(e => `${e.code}|${e.rarity}`), [
    'SGX2-DEA12|Common', 'JUSH-DE014|Rare', 'ABC-DE001|Super Rare', 'ABC-DE002|Rare',
    'ABC-DE003|Ultra Rare', 'ABC-DE004|Unknown', 'ABC-DE005|Unknown',
  ]);
  assert.deepEqual(verified.get('74677422'), [{ code: 'LOB-DE070', rarity: 'Ultra Rare', lang: 'DE' }]);
  assert.equal(carriedPrintings, 8);
});

test('mergeVerified: lokale Rarity-Reste werden ebenso bereinigt', () => {
  const local = new Map([['1', [
    { code: 'A-DE001', rarity: 'Common<!--', lang: 'DE' },
    { code: 'A-DE001', rarity: 'Common', lang: 'DE' },
  ]]]);
  assert.deepEqual(mergeVerified(local, null).verified.get('1'), [{ code: 'A-DE001', rarity: 'Common', lang: 'DE' }]);
});

test('mergeVerified: Unknown faellt weg, sobald derselbe Code eine bekannte Rarity hat (beide Reihenfolgen)', () => {
  // v11: Mitsurugi no Miko, Wousu 76948970 -- ALIN-DE091 als Common UND als Unknown
  const prev = { cards: [
    { id: 76948970, printings_verified: [
      { code: 'ALIN-DE091', rarity: 'Common', lang: 'DE' },
      { code: 'L26D-DEM07', rarity: 'Common', lang: 'DE' },
      { code: 'ALIN-DE091', rarity: 'Unknown', lang: 'DE' },
    ] },
    { id: 83994646, printings_verified: [
      { code: 'PSV-G088', rarity: 'Unknown', lang: 'DE' },
      { code: 'PSV-G088', rarity: 'Common', lang: 'DE' },
      { code: 'PSV-G099', rarity: 'Unknown', lang: 'DE' },                // ohne bekannte Rarity -> bleibt
    ] },
  ] };
  const local = new Map([['5', [
    { code: 'X-DE001', rarity: 'Unknown', lang: 'DE' },
    { code: 'X-DE001', rarity: 'Rare', lang: 'DE' },
  ]]]);
  const { verified, carriedPrintings } = mergeVerified(local, prev);
  const keys = (id) => verified.get(id).map(e => `${e.code}|${e.rarity}`);
  assert.deepEqual(keys('76948970'), ['ALIN-DE091|Common', 'L26D-DEM07|Common']);
  assert.deepEqual(keys('83994646'), ['PSV-G088|Common', 'PSV-G099|Unknown']);
  assert.deepEqual(keys('5'), ['X-DE001|Rare']);
  assert.equal(carriedPrintings, 4);
});

test('mergeVerified nimmt lokal auch Map<code|rarity, Eintrag> an', () => {
  const local = new Map([['46986414', new Map([['LOB-DE005|Ultra Rare', { code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE' }]])]]);
  const { verified } = mergeVerified(local, PREV);
  assert.deepEqual(verified.get('46986414').map(e => `${e.code}|${e.rarity}`), ['LOB-DE005|Ultra Rare']);
});

test('mergeVerified verwirft Karten, die es im neuen Bau nicht mehr gibt', () => {
  const { verified, carriedCards } = mergeVerified(new Map(), PREV, { knownIds: new Set(['89631139']) });
  assert.deepEqual([...verified.keys()], ['89631139']);
  assert.equal(carriedCards, 1);
});

test('mergeVerified verwirft kaputte und nicht-deutsche Eintraege aus dem Vorgaenger', () => {
  const prev = { cards: [
    { id: 5, printings_verified: [
      { code: 'ABC-DE001', rarity: 'Rare', lang: 'DE' },
      { code: 'ABC-KR001', rarity: 'Rare', lang: 'KR' },     // KR gehoert nie in printings_verified
      { code: 'ABC-EN001', rarity: 'Rare', lang: 'DE' },     // kein deutscher Code
      { code: 'ABC-DE002', rarity: 'Rare', lang: 'EN' },     // falsche Sprache
      { code: '', rarity: 'Rare', lang: 'DE' },
      { code: 'ABC-DE003', rarity: '', lang: 'DE' },
      { code: 'ABC-DE004', lang: 'DE' },
      { code: 42, rarity: 'Rare', lang: 'DE' },
      null,
      { code: 'ABC-DE001', rarity: 'Rare', lang: 'DE' },     // doppelt
      { code: 'ABC-DE005', rarity: 'Rare' },                  // lang fehlt -> DE wie attachVerified
    ] },
    { id: null, printings_verified: [{ code: 'X-DE001', rarity: 'Rare', lang: 'DE' }] },
    { id: 6, printings_verified: 'kaputt' },
    null,
  ] };
  const { verified, carriedPrintings } = mergeVerified(new Map(), prev);
  assert.deepEqual([...verified.keys()], ['5']);
  assert.deepEqual(verified.get('5'), [
    { code: 'ABC-DE001', rarity: 'Rare', lang: 'DE' },
    { code: 'ABC-DE005', rarity: 'Rare', lang: 'DE' },
  ]);
  assert.equal(carriedPrintings, 2);
});

test('mergeVerified ohne Vorgaenger (null) liefert lokal unveraendert', () => {
  const local = new Map([['1', [{ code: 'A-DE001', rarity: 'Rare', lang: 'DE' }]]]);
  for (const prev of [null, undefined, {}, { cards: 'x' }]) {
    const { verified, carriedCards, carriedPrintings } = mergeVerified(local, prev);
    assert.deepEqual([...verified.entries()], [['1', [{ code: 'A-DE001', rarity: 'Rare', lang: 'DE' }]]]);
    assert.equal(carriedCards, 0);
    assert.equal(carriedPrintings, 0);
  }
});

test('mergeVerified akzeptiert auch das cards-Array direkt', () => {
  assert.equal(mergeVerified(new Map(), PREV.cards).carriedPrintings, 4);
});

test('Roundtrip: Vorgaenger -> mergeVerified -> attachVerified -> attachCm ergibt dieselben printings_verified', () => {
  const cards = mergeCards(EN, DE);                  // Karte 46986414
  const { verified } = mergeVerified(new Map(), PREV, { knownIds: new Set(cards.map(c => String(c.id))) });
  attachVerified(cards, verified);
  attachCm(cards, (_n, code) => (code === 'LOB-DE005' ? [1, 2] : null));
  assert.deepEqual(cards[0].printings_verified, PREV.cards[0].printings_verified);
});

test('isGermanCode: -DE und -G<Ziffer>, sonst nicht', () => {
  assert.equal(isGermanCode('LOB-DE005'), true);
  assert.equal(isGermanCode('SDK-G001'), true);
  assert.equal(isGermanCode('LOB-EN005'), false);
  assert.equal(isGermanCode('LOB-KR005'), false);
});
