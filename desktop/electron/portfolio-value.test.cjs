const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSealedSchema, addSealed } = require('./sealed-items.cjs');
const { recordPortfolioValue, portfolioTotals } = require('./portfolio-value.cjs');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(d);
  ensureSealedSchema(d);
  d.prepare(`INSERT INTO cards (id,set_code,language,rarity,price,quantity,deleted) VALUES ('1','A-DE001','DE','Rare',10,0,0)`).run();
  d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,condition) VALUES ('c1','1','A-DE001','DE','Rare','NM')`).run();
  return d;
}
const count = (d) => d.prepare('SELECT COUNT(*) n FROM portfolio_history').get().n;

test('erste Zeile wird immer geschrieben', () => {
  const d = db();
  assert.equal(recordPortfolioValue(d), true);
  assert.equal(d.prepare('SELECT total_value FROM portfolio_history').get().total_value, 10);
});

test('0,50 EUR oder weniger Aenderung schreibt nichts, mehr schreibt', () => {
  const d = db();
  recordPortfolioValue(d);
  d.prepare(`UPDATE cards SET price = 10.5 WHERE id = '1'`).run();
  assert.equal(recordPortfolioValue(d), false);
  assert.equal(count(d), 1);
  d.prepare(`UPDATE cards SET price = 10.51 WHERE id = '1'`).run();
  assert.equal(recordPortfolioValue(d), true);
  assert.equal(count(d), 2);
});

test('ohne Sealed: Gesamtwert = Kartenwert, sealed_value 0', () => {
  const d = db();
  assert.deepEqual(portfolioTotals(d), { cards: 10, sealed: 0, total: 10, sealedCount: 0 });
  recordPortfolioValue(d);
  assert.deepEqual({ ...d.prepare('SELECT total_value, sealed_value FROM portfolio_history').get() }, { total_value: 10, sealed_value: 0 });
});

test('Spec G3 §4.2: Sealed zählt zum Gesamtwert und steht in sealed_value', () => {
  const d = db();
  addSealed(d, { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 }, 2);
  addSealed(d, { cm_product_id: 254468, name: 'Legend of Blue Eyes White Dragon Booster Box', kind: 'display', trend: null }, 1);
  assert.deepEqual(portfolioTotals(d), { cards: 10, sealed: 998.58, total: 1008.58, sealedCount: 2 });
  assert.equal(recordPortfolioValue(d), true);
  assert.deepEqual({ ...d.prepare('SELECT total_value, sealed_value FROM portfolio_history').get() }, { total_value: 1008.58, sealed_value: 998.58 });
});
