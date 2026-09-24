import test from 'node:test';
import assert from 'node:assert/strict';
import { unknownCardGroups } from './unknownCards.js';

test('unknownCardGroups: nur Unknown, eine Kachel je Passcode, Drucke als variants', () => {
  const rows = [
    { id: 1, name: 'Zeta', set_code: 'Unknown', language: 'DE', rarity: 'Common', quantity: 2, price: 1 },
    { id: 1, name: 'Zeta', set_code: 'Unknown', language: 'EN', rarity: 'Common', quantity: 1, price: 1 },
    { id: 2, name: 'Alpha', set_code: 'Unknown', language: 'DE', rarity: 'Unknown', quantity: 1 },
    { id: 3, name: 'Beta', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', quantity: 1 },
    { id: 4, name: 'Geloescht', set_code: 'Unknown', language: 'DE', rarity: 'Common', quantity: 1, deleted: 1 },
  ];
  const g = unknownCardGroups(rows);
  assert.deepEqual(g.map(x => x.id), [2, 1], 'nach Name sortiert, ohne bekannte und geloeschte Drucke');
  assert.equal(g[1].quantity, 3);
  assert.equal(g[1].variants.length, 2);
  assert.equal(g[1].totalValue, 3);
});

test('unknownCardGroups: leere oder fehlende Eingabe ergibt keine Kacheln', () => {
  assert.deepEqual(unknownCardGroups(null), []);
  assert.deepEqual(unknownCardGroups([]), []);
});
