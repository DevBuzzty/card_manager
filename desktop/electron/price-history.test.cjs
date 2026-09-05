const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { recordPrice, lastRecorded } = require('./price-history.cjs');

const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d); return d;
}

test('records only changes, one row per day (last wins), ignores non-positive', () => {
  const d = db();
  assert.equal(lastRecorded(d, P), null);
  assert.equal(recordPrice(d, P, 0, 'ygoprodeck'), false);
  assert.equal(recordPrice(d, P, 1.5, 'ygoprodeck'), true);
  assert.equal(recordPrice(d, P, 1.5, 'cm_bulk'), false, 'same price -> no write');
  assert.equal(recordPrice(d, P, 2.0, 'cm_bulk'), true);
  const rows = d.prepare('SELECT price, source, variant FROM price_history').all();
  assert.deepStrictEqual(rows, [{ price: 2.0, source: 'cm_bulk', variant: 'base' }], 'same day -> upsert, not a second row');
  assert.equal(lastRecorded(d, P), 2.0);
  assert.equal(recordPrice(d, P, 3.0, 'cm_scrape', 'first'), true, 'variants are independent series');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM price_history').get().n, 2);
});
