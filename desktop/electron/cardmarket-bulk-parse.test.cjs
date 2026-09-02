// desktop/electron/cardmarket-bulk-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const {
  expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl,
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

test('idProductFromImageUrl reads the doubled id from the product image URL', () => {
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg'), 102800);
  assert.equal(idProductFromImageUrl('https://product-images.s3.cardmarket.com/5/RA01/741144/741144.webp?v=2'), 741144);
  assert.equal(idProductFromImageUrl('https://static.cardmarket.com/img/placeholder.png'), null);
  assert.equal(idProductFromImageUrl(''), null);
  assert.equal(idProductFromImageUrl(null), null);
});
