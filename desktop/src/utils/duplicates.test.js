import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_DEFAULT, LOADING, keepPerCard, duplicates, duplicatesSummary, forSaleSummary, forSaleGroups, euroCents, euroWhole,
  headerText, confirmAllText, rowCountText, proposalTexts, forSaleHeaderText, startSaleText, startDuplicatesText,
  saleShareText, forSaleSuffix, copyValueText, toggleIsOn, premarkedIds, toggleTargets, allProposalIds,
} from './duplicates.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/duplicates/duplicates.json', import.meta.url), 'utf8'));
const withBase = (list) => list.map((c) => ({ ...FIX.base, ...c }));
const mainIdOf = (p) => FIX.aliases[p] ?? p;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const copies = withBase(c.copies);
    const list = duplicates(copies, c.keep, c.catalog ? mainIdOf : null);
    assert.deepEqual(list, c.expected);
    if (c.texts) {
      const summary = duplicatesSummary(list);
      const byId = new Map(copies.map((x) => [x.copy_id, x]));
      assert.equal(headerText(summary), c.texts.header);
      assert.equal(confirmAllText(summary), c.texts.confirm);
      assert.equal(startDuplicatesText(summary), c.texts.startDuplicates);
      assert.deepEqual(list.map(rowCountText), c.texts.rows);
      assert.deepEqual(list.map((e) => proposalTexts(e, byId)), c.texts.proposals);
    }
    if (c.allProposalIds) {
      assert.deepEqual(allProposalIds(list, new Set(c.allProposalIds.forSale)), c.allProposalIds.ids);
    }
  });
}

test('Fixture: keep_per_card', () => {
  for (const k of FIX.keep) assert.equal(keepPerCard(k.raw), k.expected, JSON.stringify(k.raw));
  assert.equal(KEEP_DEFAULT, 3);
});

test('Fixture: Euro-Texte', () => {
  for (const e of FIX.euro) {
    assert.equal(euroCents(e.value), e.cents, String(e.value));
    assert.equal(euroWhole(e.value), e.whole, String(e.value));
  }
});

test('Fixture: Verkaufsliste, Summen und Texte', () => {
  const copies = withBase(FIX.forSale.copies);
  const s = forSaleSummary(copies);
  assert.deepEqual(s, FIX.forSale.expected);
  assert.deepEqual(forSaleGroups(copies), FIX.forSale.groups);
  assert.equal(forSaleHeaderText(s), FIX.forSale.texts.header);
  assert.equal(startSaleText(s), FIX.forSale.texts.start);
  assert.equal(saleShareText(s), FIX.forSale.texts.share);
  for (const [id, text] of Object.entries(FIX.forSale.copyValues)) {
    assert.equal(copyValueText(copies.find((c) => c.copy_id === id)), text, id);
  }
  for (const t of FIX.summaryTexts) {
    assert.equal(forSaleHeaderText(t.summary), t.header);
    assert.equal(startSaleText(t.summary), t.start);
    assert.equal(saleShareText(t.summary), t.share);
  }
  for (const x of FIX.suffix) assert.equal(forSaleSuffix(x.n), x.text);
});

test('Fixture: Zeilen-Schalter', () => {
  const entry = FIX.toggle.entry;
  for (const c of FIX.toggle.cases) {
    const marked = new Set(c.forSale);
    const pre = premarkedIds(entry, marked);
    assert.equal(toggleIsOn(entry, marked), c.isOn, c.name);
    assert.deepEqual(pre, c.premarked, c.name);
    assert.deepEqual(toggleTargets(entry, true, pre), { ids: c.on, value: true }, c.name);
    assert.deepEqual(toggleTargets(entry, false, pre), { ids: c.offWithHistory, value: false }, c.name);
    assert.deepEqual(toggleTargets(entry, false, null), { ids: c.offWithoutHistory, value: false }, c.name);
  }
});

test('Platzhalter ist nie eine Null', () => {
  assert.equal(LOADING, '…');
});
