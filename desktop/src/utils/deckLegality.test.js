import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deckLegality, badgeText, badgeKind, banOf, BAN_LABELS, banlistDateText, canAddCopy, normalizeFormat, FORMAT_LABELS,
  violationCountText,
} from './deckLegality.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckLegalityTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/legality.json', import.meta.url), 'utf8'));
const cardsOf = (c) => [...c.base.flatMap((b) => FIX.bases[b]), ...c.cards];

for (const c of FIX.legality) {
  test(`Fixture Legalität: ${c.name}`, () => {
    const result = deckLegality(cardsOf(c), c.format, c.catalog ? FIX.catalog : null);
    const { badge, badgeKind: kind, ...expected } = c.expected;
    assert.deepEqual(result, expected);
    assert.equal(badgeText(result, c.format), badge);
    assert.equal(badgeKind(result, c.format), kind);
  });
}

test('Fixture: Formate', () => {
  for (const f of FIX.formats) {
    assert.equal(normalizeFormat(f.format), f.normalized, String(f.format));
    assert.equal(FORMAT_LABELS[normalizeFormat(f.format)], f.label);
  }
});

test('Fixture: Banlist-Stufe und Icon-Text', () => {
  for (const b of FIX.ban) {
    const ban = banOf(b.passcode, b.format, b.catalog ? FIX.catalog : null);
    assert.equal(ban, b.expected, JSON.stringify(b));
    assert.equal(ban ? BAN_LABELS[ban] : null, b.label);
  }
});

test('Fixture: Banlist-Stand und Anzahl Verstöße', () => {
  for (const d of FIX.banlistDate) assert.equal(banlistDateText(d.builtAt), d.text, String(d.builtAt));
  for (const v of FIX.violationCount) assert.equal(violationCountText(v.n), v.text);
});

for (const c of FIX.canAddCopy) {
  test(`Fixture Kopien-Grenze: ${c.name}`, () => {
    assert.equal(canAddCopy(c.cards, c.passcode, c.format, c.aliases ? FIX.catalog.aliases : null), c.expected);
  });
}
