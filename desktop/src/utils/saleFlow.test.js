import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastChannel, nextSteps, NEXT_STEP_LABELS, validateSale, validateListing } from './saleFlow.js';

// ZWILLING: android SaleFlowTest.kt liest dieselbe Fixture. Spec I §5.2.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/sales/sale-flow.json', import.meta.url), 'utf8'));

test('letzter Kanal', () => {
  for (const c of F.lastChannel.faelle) assert.equal(lastChannel(c.sales, F.lastChannel.fallback), c.channel, c.name);
});

test('naechster Schritt und Beschriftungen', () => {
  assert.deepEqual(NEXT_STEP_LABELS, F.nextSteps.labels);
  for (const c of F.nextSteps.faelle) {
    assert.deepEqual(nextSteps({ way: c.way, remaining: c.remaining, listingId: c.listingId }), c.steps, c.name);
  }
});

test('Verkauf pruefen: Fehler am Feld mit Abhilfe', () => {
  for (const c of F.validateSale.faelle) {
    assert.deepEqual(validateSale(c.form, { suggestionCents: c.suggestionCents, today: F.validateSale.today }), c.errors, c.name);
  }
});

test('Angebot pruefen: Fehler am Feld mit Abhilfe', () => {
  for (const c of F.validateListing.faelle) {
    assert.deepEqual(validateListing(c.form, { suggestionCents: c.suggestionCents }), c.errors, c.name);
  }
});
