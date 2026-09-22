import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from './ebayMarks.js';

// ZWILLING: android EbayMarksTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/ebay/marks.json', import.meta.url), 'utf8'));
const statusOf = (k) => (k === 'U' ? undefined : k === 'N' ? null : F.status);

test('Marken aller Fixture-Fälle', () => {
  for (const c of F.marks) assert.deepEqual(E.ebayMark(c.listing, c.row, statusOf(c.status)), c.mark, c.name);
});
test('Check-Liste', () => {
  for (const c of F.setup) {
    assert.deepEqual(E.setupItems(statusOf(c.status)), c.items);
    assert.equal(E.setupOk(statusOf(c.status)), c.ok);
  }
});
test('Ablauf-Hinweis 30 Tage vorher', () => {
  for (const c of F.expiry) {
    const s = c.disconnected ? { ...F.status, connected: false } : F.status;
    assert.equal(E.expiryText(s, c.today), c.text, c.today);
  }
});
test('Fotozähler', () => {
  for (const c of F.photoCount) assert.equal(E.photoCountText(c.n), c.text);
});
