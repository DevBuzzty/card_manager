// desktop/electron/cardmarket-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { normRarity, normName, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor } = require('./cardmarket-parse.cjs');

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

// --- Spec G4 §4: gemeinsame Versionszeilen-Auswahl (Basis- und 1st-Ed-Durchgang) ---
const noLookup = async () => { throw new Error('lookupSetName darf bei Code-Treffer nicht gerufen werden'); };

test('selectVersionRow: eine Zeile im Set ohne Rarity-Label ist eindeutig', async () => {
  const v = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, href: '/a' }];
  const hit = await selectVersionRow(v, { set_code: 'MAMO-DE020', rarity: 'Ultra Rare' }, noLookup);
  assert.equal(hit.href, '/a');
});

test('selectVersionRow: mehrere Zeilen im Set -> Rarity, bei Gleichstand die guenstigste', async () => {
  const v = [
    { expansion: 'X', code: 'RA01', rarity: 'Secret Rare', trend: 9, href: '/s1' },
    { expansion: 'X', code: 'RA01', rarity: 'Secret Rare', trend: 4, href: '/s2' },
    { expansion: 'X', code: 'RA01', rarity: 'Ultra Rare', trend: 2, href: '/u' },
  ];
  assert.equal((await selectVersionRow(v, { set_code: 'RA01-DE001', rarity: 'Secret Rare' }, noLookup)).href, '/s2');
  assert.equal((await selectVersionRow(v, { set_code: 'RA01-DE001', rarity: 'Ultra Rare' }, noLookup)).href, '/u');
});

test('selectVersionRow: ohne Code-Treffer ueber den Set-Namen (lookup wird gerufen)', async () => {
  let called = 0;
  const hit = await selectVersionRow(rows, { set_code: 'SDWL-DE001', rarity: 'Secret Rare' },
    async () => { called++; return 'Structure Deck: Wave of Light'; });
  assert.equal(called, 1);
  assert.equal(hit.trend, 1.20);
});

test('selectVersionRow: kein Treffer -> null', async () => {
  assert.equal(await selectVersionRow(rows, { set_code: 'ZZZ-DE001', rarity: 'Ghost Rare' }, async () => null), null);
});

test('productUrl: relativ -> absolut ohne Query, fremde oder fehlende Links -> null', () => {
  assert.equal(productUrl('/en/YuGiOh/Products/Singles/Maze-of-Memories/Card-V1-Ultra-Rare?language=3'),
    'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Card-V1-Ultra-Rare');
  assert.equal(productUrl('https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y'), 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y');
  assert.equal(productUrl('/en/YuGiOh/Cards/Y/Versions'), null);
  assert.equal(productUrl('https://example.com/Products/Singles/X/Y'), null);
  assert.equal(productUrl(null), null);
  assert.equal(firstEdUrl('https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y'), 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y?isFirstEd=Y');
});

test('parseFromPrice: From/Ab, Tausenderpunkt, fehlend, andere Labels ignoriert', () => {
  assert.equal(parseFromPrice([{ label: 'Available items', value: '50' }, { label: 'From', value: '58,00 €' }, { label: 'Price Trend', value: '72,33 €' }]), 58);
  assert.equal(parseFromPrice([{ label: 'Ab', value: '1.234,56 €' }]), 1234.56);
  assert.equal(parseFromPrice([{ label: 'Ab:', value: '0,15 €' }]), 0.15);
  assert.equal(parseFromPrice([{ label: 'Price Trend', value: '72,33 €' }]), null);
  assert.equal(parseFromPrice([{ label: 'From', value: 'N/A' }]), null);
  assert.equal(parseFromPrice([]), null);
  assert.equal(parseFromPrice(null), null);
});

test('firstEdFactor: Untergrenze 1, 4 Stellen, fromAll 0/NULL, fromFirst NULL', () => {
  assert.deepStrictEqual(firstEdFactor(55, 58), { write: true, factor: 1.0545 });
  assert.deepStrictEqual(firstEdFactor(3, 4), { write: true, factor: 1.3333 });
  assert.deepStrictEqual(firstEdFactor(58, 55), { write: true, factor: 1 }, 'Ausreisser nach unten wird auf 1 begrenzt');
  assert.deepStrictEqual(firstEdFactor(0, 58), { write: false, factor: null });
  assert.deepStrictEqual(firstEdFactor(null, 58), { write: false, factor: null });
  assert.deepStrictEqual(firstEdFactor(55, null), { write: true, factor: null }, 'kein Angebot mit Filter');
  assert.deepStrictEqual(firstEdFactor(55, 0), { write: true, factor: null });
});
