// desktop/electron/cardmarket-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { normRarity, normName, matchRow } = require('./cardmarket-parse.cjs');

test('normRarity strips non-letters and lowercases', () => {
  assert.equal(normRarity('Ultra Rare'), 'ultrarare');
  assert.equal(normRarity("Collector's Rare"), 'collectorsrare');
});

test('normName strips punctuation and lowercases', () => {
  assert.equal(normName('Structure Deck: Wave of Light'), 'structuredeckwaveoflight');
});

const rows = [
  { expansion: 'Structure Deck: Wave of Light', rarity: 'Ultra Rare', trend: 0.30 },
  { expansion: 'Structure Deck: Wave of Light', rarity: 'Secret Rare', trend: 1.20 },
  { expansion: '25th Anniversary Rarity Collection', rarity: 'Quarter Century Secret Rare', trend: 9.0 },
];

test('matchRow picks the exact expansion + rarity row', () => {
  const m = matchRow(rows, 'Structure Deck: Wave of Light', 'Secret Rare');
  assert.equal(m.trend, 1.20);
});

test('matchRow matches expansion fuzzily (punctuation/case differ)', () => {
  const m = matchRow(rows, 'structure deck - wave of light', 'Ultra Rare');
  assert.equal(m.trend, 0.30);
});

test('matchRow maps a rarity synonym (Quarter Century)', () => {
  const m = matchRow(rows, '25th Anniversary Rarity Collection', 'Quarter Century Secret Rare');
  assert.equal(m.trend, 9.0);
});

test('matchRow returns null when rarity is absent in that expansion', () => {
  assert.equal(matchRow(rows, 'Structure Deck: Wave of Light', 'Ghost Rare'), null);
});

test('matchRow returns null when no expansion matches', () => {
  assert.equal(matchRow(rows, 'Some Other Set', 'Ultra Rare'), null);
});
