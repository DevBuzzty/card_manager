import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckCoverage, deckBoxChoices, boxLabel, headerText, listText, costText, rowText, reservedTexts, LOADING } from './deckCoverage.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckCoverageTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/coverage.json', import.meta.url), 'utf8'));
const W = FIX.world;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const cov = deckCoverage({ deckId: c.deckId, deckCards: c.deckCards, copies: W.copies, decks: W.decks, containers: W.containers, prices: c.prices || W.prices });
    const { texts, ...numbers } = c.expected;
    assert.deepEqual(cov, numbers);
    const deck = W.decks.find((d) => d.id === c.deckId);
    assert.equal(boxLabel(deck, W.containers), texts.box);
    assert.equal(headerText(cov), texts.header);
    assert.equal(listText(cov), texts.list);
    assert.equal(costText(cov.totals), texts.cost);
    assert.deepEqual(cov.cards.map(rowText), texts.rows);
    assert.deepEqual(cov.cards.map(reservedTexts), texts.reserved);
  });
}

test('Fixture: Deckbox-Auswahl', () => {
  for (const c of FIX.choices) {
    assert.deepEqual(deckBoxChoices(c.deckId, W.decks, W.containers).map((x) => x.container_id), c.container_ids, `Deck ${c.deckId}`);
  }
});

test('Platzhalter ist nie eine Null', () => {
  assert.equal(LOADING, '…');
});
