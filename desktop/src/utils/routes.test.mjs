import assert from 'node:assert';
import { ROUTES, cardRoute, printingFromParams } from './routes.js';

assert.equal(ROUTES.start, '/start');
assert.equal(ROUTES.karten, '/sammlung/karten');
assert.equal(ROUTES.einstellungen, '/einstellungen');

// A printing key round-trips, including a rarity with a slash and a space.
const p = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ghost/Gold Rare' };
const route = cardRoute(p);
assert.ok(!route.includes('Ghost/Gold'), 'the slash inside a segment must be encoded');
const params = Object.fromEntries(
  ['id', 'setCode', 'language', 'rarity'].map((k, i) => [k, route.split('/').slice(2)[i]]),
);
assert.deepStrictEqual(printingFromParams(params), p);

// Defaults for a card that has no printing yet.
assert.equal(cardRoute({ id: '1' }), '/karte/1/Unknown/DE/Unknown');
console.log('routes test: PASS');
