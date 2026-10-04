// desktop/electron/cardmarket-bulk-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const {
  expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl,
  expansionNameVariants, decodeEntities, tokenKey,
} = require('./cardmarket-bulk-parse.cjs');

test('expansionNameFromProduct strips sealed-product suffixes', () => {
  assert.equal(expansionNameFromProduct('Legend of Blue Eyes White Dragon Booster'), 'Legend of Blue Eyes White Dragon');
  assert.equal(expansionNameFromProduct('Legend of Blue Eyes White Dragon Booster Box'), 'Legend of Blue Eyes White Dragon');
  assert.equal(expansionNameFromProduct('25th Anniversary Rarity Collection Case (12 Booster Boxes)'), '25th Anniversary Rarity Collection');
  assert.equal(expansionNameFromProduct('25th Anniversary Rarity Collection Mini Box (5 Boosters)'), '25th Anniversary Rarity Collection');
  assert.equal(expansionNameFromProduct("Structure Deck: Dragon's Roar"), "Structure Deck: Dragon's Roar"); // no suffix -> unchanged
  assert.equal(expansionNameFromProduct('Duelist Pack: Yugi (Reprint) Booster'), 'Duelist Pack: Yugi (Reprint)');
  assert.equal(expansionNameFromProduct(''), '');
});

// Fixtures cut from the real 2026-09-02 files.
const nonsingles = [
  { name: 'Legend of Blue Eyes White Dragon Booster', idExpansion: 1064 },
  { name: 'Legend of Blue Eyes White Dragon Booster Box', idExpansion: 1064 },
  { name: "Structure Deck: Dragon's Roar", idExpansion: 1069 },
  { name: '25th Anniversary Rarity Collection Booster', idExpansion: 5404 },
  { name: '25th Anniversary Rarity Collection Case (12 Booster Boxes)', idExpansion: 5404 },
  { name: 'Duelist Pack: Yugi Booster', idExpansion: 1169 },
  { name: 'Duelist Pack: Yugi (Reprint) Booster', idExpansion: 1169 },
  { name: 'Metal Raiders Booster', idExpansion: 1077 },
];
const singles = [
  { idProduct: 102800, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 577923, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 578096, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 578097, name: 'Dark Magician', idExpansion: 1064 },
  { idProduct: 102801, name: 'Dark Magician', idExpansion: 1077 },
  { idProduct: 741144, name: 'Lava Golem', idExpansion: 5404 },
  { idProduct: 741145, name: 'Lava Golem', idExpansion: 5404 },
  { idProduct: 300001, name: 'Armed Dragon LV3', idExpansion: 1069 },
];
const idx = { expansionIndex: buildExpansionIndex(nonsingles), singlesIndex: buildSinglesIndex(singles) };

test('buildExpansionIndex maps normalised expansion names to id sets', () => {
  assert.deepEqual([...idx.expansionIndex.get('legendofblueeyeswhitedragon')], [1064]);
  assert.deepEqual([...idx.expansionIndex.get('structuredeckdragonsroar')], [1069]);
  assert.deepEqual([...idx.expansionIndex.get('25thanniversaryraritycollection')], [5404]);
  assert.deepEqual([...idx.expansionIndex.get('metalraidersbooster')], [1077]); // raw product name is indexed too
  assert.equal(idx.expansionIndex.has(''), false);
});

test('buildSinglesIndex groups products by normalised card name', () => {
  assert.equal(idx.singlesIndex.get('darkmagician').length, 5);
  assert.deepEqual(idx.singlesIndex.get('armeddragonlv3'), [{ idProduct: 300001, idExpansion: 1069 }]);
});

test('resolveProduct: exactly one candidate -> resolved', () => {
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Metal Raiders'] }, idx);
  assert.deepEqual(r, { idProduct: 102801, reason: 'resolved' });
  const s = resolveProduct({ cardName: "Armed Dragon LV3", setNames: ["Structure Deck: Dragon's Roar"] }, idx);
  assert.equal(s.idProduct, 300001);
});

test('resolveProduct: several products in the expansion -> ambiguous, no guess', () => {
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Legend of Blue Eyes White Dragon'] }, idx);
  assert.deepEqual(r, { idProduct: null, reason: 'ambiguous' });
  const s = resolveProduct({ cardName: 'Lava Golem', setNames: ['25th Anniversary Rarity Collection'] }, idx);
  assert.equal(s.reason, 'ambiguous');
});

test('resolveProduct: unions all set names of a prefix (LOB + LOB 25th) before deciding', () => {
  // Both names map to expansion 1064 -> still 4 candidates -> ambiguous (not "no-expansion").
  const r = resolveProduct({ cardName: 'Dark Magician', setNames: ['Legend of Blue Eyes White Dragon', 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)'] }, idx);
  assert.equal(r.reason, 'ambiguous');
});

test('resolveProduct: unknown set name -> no-expansion; card missing in set -> no-candidate', () => {
  assert.deepEqual(resolveProduct({ cardName: 'Dark Magician', setNames: ['Some Unknown Set'] }, idx), { idProduct: null, reason: 'no-expansion' });
  assert.deepEqual(resolveProduct({ cardName: 'Lava Golem', setNames: ['Metal Raiders'] }, idx), { idProduct: null, reason: 'no-candidate' });
  assert.deepEqual(resolveProduct({ cardName: 'Dark Magician', setNames: [] }, idx), { idProduct: null, reason: 'no-expansion' });
});

test('expansionNameVariants keeps every intermediate form and strips Box Set / Card Pack / (YYYY Reprint)', () => {
  assert.deepEqual(expansionNameVariants('25th Anniversary Tin: Dueling Heroes Mega Pack Booster'), [
    '25th Anniversary Tin: Dueling Heroes Mega Pack Booster',
    '25th Anniversary Tin: Dueling Heroes Mega Pack',
    '25th Anniversary Tin: Dueling Heroes Mega',
  ]);
  assert.equal(expansionNameFromProduct("Yugi's Legendary Decks Box Set (2021 Reprint)"), "Yugi's Legendary Decks");
  assert.equal(expansionNameFromProduct('Structure Deck: Synchron Extreme Card Pack'), 'Structure Deck: Synchron Extreme');
  assert.deepEqual(expansionNameVariants(''), []);
});

test('decodeEntities and tokenKey', () => {
  assert.equal(decodeEntities('Legendary 5D&apos;s Decks'), "Legendary 5D's Decks");
  assert.equal(decodeEntities('Yuya &amp; Declan'), 'Yuya & Declan');
  assert.equal(tokenKey('Synchron Extreme Structure Deck'), tokenKey('Structure Deck: Synchron Extreme'));
  assert.equal(tokenKey('Metal Raiders'), 'metal|raiders');
  assert.equal(tokenKey('Booster'), ''); // single token: exact key already covers it
});

// Fixtures from the real files (2026-09-02) for the four measured gaps.
const nonsingles2 = [
  { name: "Yugi's Legendary Decks Box Set", idExpansion: 1674 },
  { name: "Legendary 5D's Decks Box Set", idExpansion: 3001 },
  { name: 'Structure Deck: Synchron Extreme', idExpansion: 1664 },
  { name: '25th Anniversary Tin: Dueling Heroes Mega Pack Booster', idExpansion: 5465 },
];
const singles2 = [
  { idProduct: 1, name: 'Dark Magician', idExpansion: 1674 },
  { idProduct: 2, name: 'Junk Synchron', idExpansion: 3001 },
  { idProduct: 3, name: 'Junk Synchron', idExpansion: 1664 },
  { idProduct: 4, name: 'Dark Magician', idExpansion: 5465 },
];
const idx2 = { expansionIndex: buildExpansionIndex(nonsingles2), singlesIndex: buildSinglesIndex(singles2) };

test('resolveProduct handles Box Set suffix, HTML entity, word order and intermediate variants', () => {
  assert.equal(resolveProduct({ cardName: 'Dark Magician', setNames: ["Yugi's Legendary Decks"] }, idx2).idProduct, 1);
  assert.equal(resolveProduct({ cardName: 'Junk Synchron', setNames: ['Legendary 5D&apos;s Decks'] }, idx2).idProduct, 2);
  assert.equal(resolveProduct({ cardName: 'Junk Synchron', setNames: ['Synchron Extreme Structure Deck'] }, idx2).idProduct, 3);
  assert.equal(resolveProduct({ cardName: 'Dark Magician', setNames: ['25th Anniversary Tin: Dueling Heroes Mega Pack'] }, idx2).idProduct, 4);
});

test('idProductFromImageUrl reads the doubled id from the product image URL', () => {
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg'), 102800);
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/RA01/741144/741144.webp?v=2'), 741144);
  assert.equal(idProductFromImageUrl('https://static.cardmarket.com/img/placeholder.png'), null);
  assert.equal(idProductFromImageUrl(''), null);
  assert.equal(idProductFromImageUrl(null), null);
});

// --- Abgeleitete Produkt-IDs ---
const { buildVersionIndex, learnRanks, deriveProduct, orderForLearning } = require('./cardmarket-bulk-parse.cjs');

// Set 5848 legt je Karte drei Versionen an, seltenheitsweise in Bloecken (wie RA03 am 04.11.2024).
const singles3 = [
  { idProduct: 100, name: 'Toadally Awesome', idExpansion: 5848 },
  { idProduct: 200, name: 'Toadally Awesome', idExpansion: 5848 },
  { idProduct: 300, name: 'Toadally Awesome', idExpansion: 5848 },
  { idProduct: 101, name: 'Effect Veiler', idExpansion: 5848 },
  { idProduct: 201, name: 'Effect Veiler', idExpansion: 5848 },
  { idProduct: 301, name: 'Effect Veiler', idExpansion: 5848 },
  { idProduct: 102, name: 'Ash Blossom & Joyous Spring', idExpansion: 5848 },
  { idProduct: 202, name: 'Ash Blossom & Joyous Spring', idExpansion: 5848 },
  { idProduct: 302, name: 'Ash Blossom & Joyous Spring', idExpansion: 5848 },
  { idProduct: 900, name: 'Toadally Awesome', idExpansion: 7000 },
  { idProduct: 901, name: 'Toadally Awesome', idExpansion: 7000 },
];
const ix3 = { expansionIndex: buildExpansionIndex([{ name: 'Quarter Century Bonanza Booster', idExpansion: 5848 }, { name: 'Other Set Booster', idExpansion: 7000 }]),
  versionIndex: buildVersionIndex(singles3) };
const qcb = ['Quarter Century Bonanza'];
const three = ['Super Rare', 'Ultra Rare', 'Secret Rare'];

test('buildVersionIndex sortiert die Versionen je Karte und Set nach idProduct', () => {
  assert.deepEqual(ix3.versionIndex.byKey.get('toadallyawesome|5848'), [100, 200, 300]);
  assert.deepEqual(ix3.versionIndex.pos.get(201), { exp: 5848, n: 3, rank: 1 });
});

test('deriveProduct leitet die Version aus zwei einigen Vorbildern ab', () => {
  const learned = learnRanks([{ rarity: 'Super Rare', idProduct: 201 }, { rarity: 'Super Rare', idProduct: 202 }], ix3.versionIndex);
  const r = deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Super Rare', printingRarities: three }, { ...ix3, learned });
  assert.deepEqual(r, { idProduct: 200, groupKey: '5848|3|Super Rare', reason: 'derived' });
});

test('deriveProduct raet nicht: ein Vorbild, Widerspruch, fremde Seltenheit, mehrere Sets', () => {
  const one = learnRanks([{ rarity: 'Super Rare', idProduct: 201 }], ix3.versionIndex);
  assert.equal(deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Super Rare', printingRarities: three }, { ...ix3, learned: one }).reason, 'too-few');
  const clash = learnRanks([{ rarity: 'Super Rare', idProduct: 201 }, { rarity: 'Super Rare', idProduct: 302 }], ix3.versionIndex);
  assert.equal(deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Super Rare', printingRarities: three }, { ...ix3, learned: clash }).reason, 'conflict');
  const two = learnRanks([{ rarity: 'Super Rare', idProduct: 201 }, { rarity: 'Super Rare', idProduct: 202 }], ix3.versionIndex);
  assert.equal(deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Ultra Rare', printingRarities: three }, { ...ix3, learned: two }).reason, 'no-model');
  assert.equal(deriveProduct({ cardName: 'Toadally Awesome', setNames: [...qcb, 'Other Set'], rarity: 'Super Rare', printingRarities: three }, { ...ix3, learned: two }).reason, 'no-group');
  // Deck-Set: eine Seltenheit mehrfach -> Versionen stehen nicht fuer Seltenheiten
  const decks = deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Super Rare', printingRarities: ['Super Rare', 'Super Rare', 'Ultra Rare'] }, { ...ix3, learned: two });
  assert.deepEqual(decks, { idProduct: null, groupKey: null, reason: 'not-by-rarity' });
  // Cardmarket hat mehr Versionen als YGOPRODeck Drucke kennt -> nicht ableiten
  assert.equal(deriveProduct({ cardName: 'Toadally Awesome', setNames: qcb, rarity: 'Super Rare', printingRarities: ['Super Rare', 'Ultra Rare'] }, { ...ix3, learned: two }).reason, 'not-by-rarity');
});

test('orderForLearning zieht je Gruppe zwei Karten vor, Karten ohne Gruppe bleiben vorn', () => {
  const keys = { a1: ['A'], a2: ['A'], a3: ['A'], b1: ['B'], x: [] };
  const order = orderForLearning(['a1', 'a2', 'a3', 'b1', 'x'], k => keys[k]);
  assert.deepEqual(order, ['a1', 'a2', 'b1', 'x', 'a3']);
  // Gruppe A hat schon ein Vorbild -> nur noch eine Karte vorziehen
  assert.deepEqual(orderForLearning(['a1', 'a2', 'b1'], k => keys[k], k => (k === 'A' ? 1 : 0)), ['a1', 'b1', 'a2']);
});

const { idFromVersionRow } = require('./cardmarket-bulk-parse.cjs');

test('idFromVersionRow: V.n ist die n-te idProduct der Karte im Set (Log 02.10.2026, Bild ohne Adresse)', () => {
  const singles = [
    { idProduct: 578029, name: 'Armed Ninja', idExpansion: 1064 },
    { idProduct: 101998, name: 'Armed Ninja', idExpansion: 1064 },
    { idProduct: 578424, name: 'Armed Ninja', idExpansion: 1064 },
    { idProduct: 700000, name: 'Solo Card', idExpansion: 1064 },
  ];
  const ix = { expansionIndex: buildExpansionIndex([{ name: 'Legend of Blue Eyes White Dragon Booster', idExpansion: 1064 }]),
    versionIndex: buildVersionIndex(singles) };
  const exp = 'Legend of Blue Eyes White Dragon';
  assert.equal(idFromVersionRow({ cardName: 'Armed Ninja', expansion: exp, alt: 'Armed Ninja (V.1 - Rare)' }, ix), 101998);
  assert.equal(idFromVersionRow({ cardName: 'Armed Ninja', expansion: exp, alt: 'Armed Ninja (V.3 - Common)' }, ix), 578424);
  assert.equal(idFromVersionRow({ cardName: 'Armed Ninja', expansion: exp, alt: 'Armed Ninja (V.4 - Rare)' }, ix), null); // gibt es nicht
  assert.equal(idFromVersionRow({ cardName: 'Armed Ninja', expansion: exp, alt: 'Armed Ninja' }, ix), null);           // mehrere, keine V-Nummer
  assert.equal(idFromVersionRow({ cardName: 'Solo Card', expansion: exp, alt: 'Solo Card' }, ix), 700000);              // einzige Version
  assert.equal(idFromVersionRow({ cardName: 'Armed Ninja', expansion: 'Unbekanntes Set', alt: 'Armed Ninja (V.1 - Rare)' }, ix), null);
});

const { cmForPrinting } = require('./cardmarket-bulk-parse.cjs');

test('cmForPrinting: echte ID > eindeutig > abgeleitet > Kandidaten > null', () => {
  const singles = [
    { idProduct: 10, name: 'Solo Card', idExpansion: 7 },
    { idProduct: 30, name: 'Toadally Awesome', idExpansion: 7 },
    { idProduct: 20, name: 'Toadally Awesome', idExpansion: 7 },
  ];
  const base = {
    expansionIndex: buildExpansionIndex([{ name: 'Some Set Booster', idExpansion: 7 }]),
    singlesIndex: buildSinglesIndex(singles),
    versionIndex: buildVersionIndex(singles),
  };
  const set = ['Some Set'];
  const keinModell = { ...base, learned: new Map() };
  // echte ID aus der Sammlung gewinnt immer
  assert.equal(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: [], realId: 99 }, keinModell), 99);
  // eindeutig in den Dateien
  assert.equal(cmForPrinting({ cardName: 'Solo Card', setNames: set, rarity: 'Common', printingRarities: ['Common'] }, keinModell), 10);
  // mehrdeutig, kein Modell -> alle Kandidaten aufsteigend
  assert.deepEqual(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: ['Super Rare', 'Ultra Rare'] }, keinModell), [20, 30]);
  // mehrdeutig, Modell mit 2 Vorbildern auf Position 1 -> abgeleitet
  const learned = new Map([['7|2|Ultra Rare', new Map([[1, 2]])]]);
  assert.equal(cmForPrinting({ cardName: 'Toadally Awesome', setNames: set, rarity: 'Ultra Rare', printingRarities: ['Super Rare', 'Ultra Rare'] }, { ...base, learned }), 30);
  // Set unbekannt -> null
  assert.equal(cmForPrinting({ cardName: 'Solo Card', setNames: ['Gibt Es Nicht'], rarity: 'Common', printingRarities: [] }, keinModell), null);
});
