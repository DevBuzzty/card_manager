import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeckText, detectFormat, buildYdk, buildYdke, buildTextList, parseTextList, normalizePasscode } from './deckFormats.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckFormatsTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/formats.json', import.meta.url), 'utf8'));

for (const c of FIX.parse) {
  test(`Fixture lesen: ${c.name}`, () => {
    const got = c.format ? parseDeckText(c.text, c.format) : parseDeckText(c.text);
    assert.deepEqual({ ...got, error: got.error ?? null }, c.expected);
  });
}

test('Fixture: Erkennung', () => {
  for (const d of FIX.detect) assert.equal(detectFormat(d.text), d.format, JSON.stringify(d.text));
});

const sectionSums = (cards) => ['main', 'extra', 'side'].map((s) => cards.filter((c) => c.section === s).reduce((a, c) => a + c.count, 0));

for (const b of FIX.build) {
  test(`Fixture schreiben und zurücklesen: ${b.name}`, () => {
    assert.equal(buildYdk(b.entries), b.ydk);
    assert.equal(buildYdke(b.entries), b.ydke);
    assert.equal(buildTextList(b.entries), b.text);
    if (b.roundtrip.length) {
      assert.deepEqual(parseDeckText(b.ydk).cards, b.roundtrip);
      assert.deepEqual(parseDeckText(b.ydke).cards, b.roundtrip);
      assert.deepEqual(sectionSums(parseTextList(b.text).cards), sectionSums(b.roundtrip));
    }
  });
}

test('Passcodes: führende Nullen weg, 0 und zu groß ungültig', () => {
  assert.equal(normalizePasscode('04031928'), '4031928');
  assert.equal(normalizePasscode('4294967295'), '4294967295');
  assert.equal(normalizePasscode('4294967296'), null);
  assert.equal(normalizePasscode('0000'), null);
  assert.equal(normalizePasscode('12a'), null);
});
