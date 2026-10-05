// desktop/electron/cardmarket-parse.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { normRarity, normName, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor,
  CM_LANGUAGES, offersUrl, parseOffers, robustLow, robustFactor, FIRST_ED_FACTOR_MAX } = require('./cardmarket-parse.cjs');
const path = require('path');
const fixture = (name) => require(path.join(__dirname, 'fixtures', name));

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
  assert.equal(parseFromPrice([{ label: 'From', value: '58 €' }]), 58);
  assert.equal(parseFromPrice([{ label: 'From', value: '1.234 €' }]), 1234);
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

test('robustFactor (G4b): Untergrenze 1, Obergrenze 10, 4 Stellen, fehlende Seite -> NULL', () => {
  assert.deepStrictEqual(robustFactor(55, 58), { factor: 1.0545, capped: false, raw: 1.0545 });
  assert.deepStrictEqual(robustFactor(3, 4), { factor: 1.3333, capped: false, raw: 1.3333 });
  assert.deepStrictEqual(robustFactor(58, 55), { factor: 1, capped: false, raw: 0.9483 }, 'Ausreisser nach unten -> 1');
  assert.deepStrictEqual(robustFactor(8, 80), { factor: 10, capped: false, raw: 10 }, 'genau 10 ist nicht gekappt');
  assert.deepStrictEqual(robustFactor(8.09, 76.86), { factor: 9.5006, capped: false, raw: 9.5006 });
  assert.deepStrictEqual(robustFactor(2, 50), { factor: FIRST_ED_FACTOR_MAX, capped: true, raw: 25 });
  assert.deepStrictEqual(robustFactor(null, 58), { factor: null, capped: false, raw: null });
  assert.deepStrictEqual(robustFactor(0, 58), { factor: null, capped: false, raw: null });
  assert.deepStrictEqual(robustFactor(55, null), { factor: null, capped: false, raw: null });
});

test('selectVersionRow: Cardmarket "Shatterfoil" trifft "Shatterfoil Rare" (Toy Vendor SP15, Log 02.10.2026)', async () => {
  const { selectVersionRow } = require('./cardmarket-parse.cjs');
  const rows = [
    { code: 'SP15', rarity: 'Shatterfoil', trend: 0.4, expansion: 'Star Pack 2015' },
    { code: 'SP15', rarity: 'Common', trend: 0.05, expansion: 'Star Pack 2015' },
  ];
  const hit = await selectVersionRow(rows, { set_code: 'SP15-DE043', rarity: 'Shatterfoil Rare' }, async () => null);
  assert.equal(hit, rows[0]);
});

test('offersUrl: isFirstEd Y/N, Sprache und Mindestzustand EX', () => {
  const P = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y';
  assert.equal(offersUrl(P, true, 'DE'), `${P}?isFirstEd=Y&language=3&minCondition=3`);
  assert.equal(offersUrl(P, false, 'EN'), `${P}?isFirstEd=N&language=1&minCondition=3`);
  assert.equal(offersUrl(P, false, 'KR'), `${P}?isFirstEd=N&minCondition=3`, 'Sprache ohne Cardmarket-Id -> kein Sprachparameter');
  assert.equal(CM_LANGUAGES.KR, undefined);
});

test('parseOffers: Preisformate, Zustand normalisiert, Sprache aus den Labels, unlesbarer Preis faellt weg', () => {
  const rows = [
    { priceText: '1.234,56 €', condition: 'nm', labels: ['Near Mint', 'German'] },
    { priceText: '0,15 €', condition: 'EX', labels: ['Deutsch', 'First Edition'] },
    { priceText: '58 €', condition: 'MT', labels: ['English'] },
    { priceText: 'N/A', condition: 'NM', labels: ['German'] },
    { priceText: '3,00 €', condition: 'NM', labels: ['Klingon'] },
    { priceText: '2,00 €', condition: 'NM', labels: ['Französisch'] },
  ];
  assert.deepStrictEqual(parseOffers(rows), [
    { price: 1234.56, condition: 'NM', language: 'DE' },
    { price: 0.15, condition: 'EX', language: 'DE' },
    { price: 58, condition: 'MT', language: 'EN' },
    { price: 3, condition: 'NM', language: null },
    { price: 2, condition: 'NM', language: 'FR' },
  ]);
  assert.deepStrictEqual(parseOffers(null), []);
});

test('parseOffers: veraenderte oder signierte Karten zaehlen nicht (Messung: Altered unter den guenstigsten)', () => {
  const rows = [
    { priceText: '5,00 €', condition: 'EX', labels: ['Excellent', 'German', 'First Edition', 'Altered'] },
    { priceText: '6,00 €', condition: 'EX', labels: ['Excellent', 'German', 'Signed'] },
    { priceText: '7,00 €', condition: 'EX', labels: ['Excellent', 'German'] },
  ];
  assert.deepStrictEqual(parseOffers(rows), [{ price: 7, condition: 'EX', language: 'DE' }]);
});

const de = (price, condition = 'NM') => ({ price, condition, language: 'DE' });

test('robustLow: unter 3 Angeboten null, genau 3, gerade Anzahl, nur die 5 guenstigsten', () => {
  assert.equal(robustLow([], { language: 'DE' }), null);
  assert.equal(robustLow([de(1), de(2)], { language: 'DE' }), null);
  assert.equal(robustLow([de(3), de(1), de(2)], { language: 'DE' }), 2);
  assert.equal(robustLow([de(4), de(1), de(2), de(3)], { language: 'DE' }), 2.5);
  assert.equal(robustLow([de(1), de(2), de(3), de(4), de(5), de(100), de(200)], { language: 'DE' }), 3);
});

test('robustLow: Ausreisser unten/oben verschieben den Wert nicht', () => {
  assert.equal(robustLow([de(0.5), de(8), de(8.5), de(9), de(9.5)], { language: 'DE' }), 8.5);
  assert.equal(robustLow([de(8), de(8.5), de(9), de(9.5), de(500)], { language: 'DE' }), 9);
});

test('robustLow: filtert Sprache und Zustand selbst (falls Cardmarket den URL-Filter ignoriert)', () => {
  const offers = [de(1, 'PO'), de(1, 'LP'), de(2, 'GD'), { price: 1, condition: 'NM', language: 'EN' },
    { price: 1, condition: 'NM', language: null }, de(5), de(6, 'EX'), de(7, 'MT')];
  assert.equal(robustLow(offers, { language: 'DE' }), 6);
  assert.equal(robustLow(offers, { language: 'EN' }), null);
});

test('robustLow + robustFactor auf den Mess-Fixtures: plausibel und nie ueber 10', () => {
  for (const card of ['sdj-g001', 'mamo-de020']) {
    const n = robustLow(parseOffers(fixture(`cm-offers-${card}-N.json`).rows), { language: 'DE' });
    const y = robustLow(parseOffers(fixture(`cm-offers-${card}-Y.json`).rows), { language: 'DE' });
    const { factor } = robustFactor(n, y);
    assert.ok(factor === null || (factor >= 1 && factor <= 10), `${card}: ${factor}`);
  }
  assert.equal(fixture('cm-offers-leer.json').found, true, 'leere Liste: Tabelle steht trotzdem im DOM');
  assert.equal(robustLow(parseOffers(fixture('cm-offers-leer.json').rows), { language: 'DE' }), null);
});

// Von Hand ausgerechnet im Ledger messung.md (05.10.2026): DE, MT/NM/EX, ohne Altered, Median der 5 guenstigsten.
const SDJ_N = 6, SDJ_Y = 5, MAMO_N = 65, MAMO_Y = 56.61;
test('Mess-Fixtures: Werte wie von Hand in messung.md ausgerechnet; SDJ-G001 faellt von x9,50 auf x1', () => {
  const r = (f) => robustLow(parseOffers(fixture(f).rows), { language: 'DE' });
  assert.equal(r('cm-offers-sdj-g001-N.json'), SDJ_N);
  assert.equal(r('cm-offers-sdj-g001-Y.json'), SDJ_Y);
  assert.equal(r('cm-offers-mamo-de020-N.json'), MAMO_N);
  assert.equal(r('cm-offers-mamo-de020-Y.json'), MAMO_Y);
  assert.equal(robustFactor(SDJ_N, SDJ_Y).factor, 1);
  assert.equal(robustFactor(MAMO_N, MAMO_Y).factor, 1);
});
