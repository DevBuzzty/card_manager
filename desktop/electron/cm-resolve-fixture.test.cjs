// desktop/electron/cm-resolve-fixture.test.cjs -- Spec 2026-11-03 §9.3 (Weg 1): das Original cardmarket-bulk-parse.cjs gegen
// docs/fixtures/cm-resolve/parse.json. Twin: supabase/functions/_shared/cm-parse_test.ts prueft denselben Inhalt am Deno-Port.
// Reine Logik, laeuft mit `node --test` (ohne Electron).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildExpansionIndex, buildSinglesIndex, buildVersionIndex, learnRanks, resolveProduct, deriveProduct, cmForPrinting,
  expansionNameVariants,
} = require('./cardmarket-bulk-parse.cjs');

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/cm-resolve/parse.json'), 'utf8'));
const versionIndex = buildVersionIndex(fx.files.singles);
const ix = {
  expansionIndex: buildExpansionIndex(fx.files.nonsingles),
  singlesIndex: buildSinglesIndex(fx.files.singles),
  versionIndex,
  learned: learnRanks(fx.known, versionIndex),
};
const setNamesOf = (prefix) => fx.files.cardsets.filter(s => String(s.set_code).toUpperCase() === prefix).map(s => s.set_name);

for (const c of fx.cases) {
  test(`parse.json: ${c.name}`, () => {
    const i = c.input;
    if (c.fn === 'expansionNameVariants') return assert.deepStrictEqual(expansionNameVariants(i.name), c.expect);
    const setNames = setNamesOf(i.prefix);
    if (c.fn === 'resolveProduct') {
      const r = resolveProduct({ cardName: i.cardName, setNames }, ix);
      return assert.deepStrictEqual({ idProduct: r.idProduct, reason: r.reason }, c.expect);
    }
    if (c.fn === 'deriveProduct') {
      const q = { cardName: i.cardName, setNames, rarity: i.rarity };
      if ('printingRarities' in i) q.printingRarities = i.printingRarities;
      const r = deriveProduct(q, ix);
      return assert.deepStrictEqual({ idProduct: r.idProduct, reason: r.reason }, c.expect);
    }
    if (c.fn === 'cmForPrinting') {
      const r = cmForPrinting({ cardName: i.cardName, setNames, rarity: i.rarity, printingRarities: i.printingRarities, realId: i.realId }, ix);
      return assert.deepStrictEqual(r, c.expect);
    }
    assert.fail(`unbekannte fn ${c.fn}`);
  });
}

// Nachtrag Set-Aliase: desktop/electron/cm-set-aliases.json ist ein 1:1-Spiegel der Twin-Fixture (electron-builder packt docs/ nicht).
const { buildSetAliases, SET_ALIASES, expansionIdsFor } = require('./cardmarket-bulk-parse.cjs');
const { normName } = require('./cardmarket-parse.cjs');
const aliasFixture = fs.readFileSync(path.join(__dirname, '../../docs/fixtures/cm-resolve/set-aliases.json'), 'utf8');

test('set-aliases.json: Desktop-Spiegel ist inhaltsgleich mit der Fixture', () => {
  const mirror = fs.readFileSync(path.join(__dirname, 'cm-set-aliases.json'), 'utf8');
  assert.deepStrictEqual(JSON.parse(mirror), JSON.parse(aliasFixture));
});

test('set-aliases.json: sortiert, eindeutige Schluessel, je Eintrag IDs und Beleg', () => {
  const list = JSON.parse(aliasFixture).aliases;
  const names = list.map(a => a.setName);
  assert.deepStrictEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.strictEqual(new Set(names.map(n => normName(n))).size, names.length);
  for (const a of list) {
    assert.ok(a.idExpansion.length > 0 && a.idExpansion.every(Number.isInteger), a.setName);
    assert.ok(a.prefix && a.cmName && a.beleg, a.setName);
  }
  assert.strictEqual(SET_ALIASES.size, list.length);
});

test('expansionIdsFor: Alias nur ohne Namens-Treffer, je set_name; eigener Alias-Satz injizierbar', () => {
  const idx = buildExpansionIndex([{ name: 'Echtes Set Booster', idExpansion: 5 }]);
  const al = buildSetAliases([{ setName: 'Echtes Set', idExpansion: [9] }, { setName: 'Promo &amp; Co', idExpansion: [7, 8] }]);
  assert.deepStrictEqual([...expansionIdsFor(['Echtes Set'], idx, al)], [5]);
  assert.deepStrictEqual([...expansionIdsFor(['Promo &amp; Co'], idx, al)], [7, 8]);
  assert.deepStrictEqual([...expansionIdsFor(['Promo & Co', 'Echtes Set'], idx, al)].sort(), [5, 7, 8]);
  assert.deepStrictEqual([...expansionIdsFor(['Promo & Co'], idx, new Map())], []);
  assert.deepStrictEqual([...expansionIdsFor(['Dark Revelation Volume 1'], idx)], [1020]); // Standard-Aliase
});
