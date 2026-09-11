import assert from 'node:assert';
import { ROUTES, binderRoute, cardRoute, printingFromParams } from './routes.js';

assert.equal(ROUTES.start, '/start');
assert.equal(ROUTES.karten, '/sammlung/karten');
assert.equal(ROUTES.einstellungen, '/einstellungen');

// A printing key round-trips, including a rarity with a slash and a space.
const p = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ghost/Gold Rare' };
const route = cardRoute(p);
assert.ok(!route.includes('Ghost/Gold'), 'the slash inside a segment must be encoded');
// useParams() hands over already-decoded segments — mirror that here.
const params = Object.fromEntries(
  ['id', 'setCode', 'language', 'rarity'].map((k, i) => [k, decodeURIComponent(route.split('/').slice(2)[i])]),
);
assert.deepStrictEqual(printingFromParams(params), p);

// Defaults for a card that has no printing yet.
assert.equal(cardRoute({ id: '1' }), '/karte/1/Unknown/DE/Unknown');

// Ein aufgeschlagener Behälter liegt UNTERHALB von /sammlung/binder — sonst verlöre das Segment
// „Binder" in SammlungLayout seine Markierung.
assert.equal(binderRoute('abc-123'), '/sammlung/binder/abc-123');
assert.ok(binderRoute('abc-123').startsWith(ROUTES.binder + '/'));
// Ein Segment mit Schrägstrich würde die Route sonst aufspalten.
assert.ok(!binderRoute('a/b').includes('a/b'), 'der Schrägstrich im Segment muss kodiert sein');
assert.equal(binderRoute(''), '/sammlung/binder/Unknown');
console.log('routes test: PASS');
