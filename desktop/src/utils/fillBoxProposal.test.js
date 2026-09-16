import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillBoxProposal, locationText, shortText, surplusText } from './fillBoxProposal.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/FillBoxProposalTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/fill-box.json', import.meta.url), 'utf8'));
const W = FIX.world;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepEqual(
      fillBoxProposal({ deckId: c.deckId, deckCards: c.deckCards, copies: W.copies, decks: W.decks, containers: W.containers }),
      c.expected,
    );
  });
}

test('Fixture: Ortstext', () => {
  const byId = new Map(W.containers.map((c) => [c.container_id, c]));
  for (const l of FIX.location) assert.equal(locationText(l.copy, byId.get(l.copy.container_id)), l.text, l.name);
});

test('Fixture: Hinweistexte', () => {
  for (const t of FIX.texts) {
    assert.equal(shortText(t.n), t.short, `short ${t.n}`);
    assert.equal(surplusText(t.n), t.surplus, `surplus ${t.n}`);
  }
});
