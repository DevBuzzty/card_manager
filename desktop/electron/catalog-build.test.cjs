const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { mergeCards, attachVerified, packCatalog } = require('./catalog-build.cjs');

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
