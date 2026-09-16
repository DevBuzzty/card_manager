import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wishlistMaxPrice, missingForWishlist, wishlistConfirmText, wishlistResultText } from './deckWishlist.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckWishlistTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/wishlist.json', import.meta.url), 'utf8'));

test('Fixture: Höchstpreis', () => {
  for (const c of FIX.maxPrice) assert.equal(wishlistMaxPrice(c.cm_price), c.max_price, String(c.cm_price));
});

for (const m of FIX.missing) {
  test(`Fixture: ${m.name}`, () => {
    assert.deepEqual(missingForWishlist(m.coverage, m.wishlist), m.expected);
  });
}

test('Fixture: Bestätigung', () => {
  for (const c of FIX.confirm) {
    const plan = { candidates: Array.from({ length: c.candidates }, (_, i) => ({ card_id: String(i), max_price: null })), alreadyListed: c.alreadyListed, withoutPrice: c.withoutPrice };
    assert.equal(wishlistConfirmText(plan), c.text);
  }
});

test('Fixture: Rückmeldung', () => {
  for (const r of FIX.result) assert.equal(wishlistResultText(r), r.text);
});
