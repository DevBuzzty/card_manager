const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { recordPortfolioValue } = require('./portfolio-value.cjs');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(d);
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
