const assert = require('assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { applyRemoteCopy } = require('./sync.cjs');

const db = new Database(':memory:');
db.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL, language TEXT DEFAULT 'DE',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
ensureCopiesSchema(db);
ensureSalesSchema(db); // card_copies.sold_in -- COPY_COLS in sync.cjs schreibt die Spalte
db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity) VALUES ('1','LOB-DE001','DE','Common',0)");
const remote = { copy_id: 'u1', card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Common', edition: 'unknown', condition: 'NM', deleted: false,
  container_id: null, page: null, slot: null, tags: null, note: null, needs_review: false, review_reason: null, for_sale: false, updated_at: '2026-01-01T00:00:00Z' };

applyRemoteCopy(db, remote);
assert.strictEqual(db.prepare("SELECT quantity FROM cards WHERE id='1'").get().quantity, 1, 'phone-created copy recounts the printing');
db.prepare("UPDATE card_copies SET updated_at = '2026-01-01 00:00:00' WHERE copy_id = 'u1'").run();

applyRemoteCopy(db, remote);
assert.strictEqual(db.prepare("SELECT updated_at FROM card_copies WHERE copy_id='u1'").get().updated_at, '2026-01-01 00:00:00', 'unchanged copy is not re-dirtied');

applyRemoteCopy(db, { ...remote, condition: 'GD', deleted: true });
assert.deepStrictEqual(db.prepare("SELECT condition, deleted FROM card_copies WHERE copy_id='u1'").get(), { condition: 'GD', deleted: 1 });
assert.strictEqual(db.prepare("SELECT deleted FROM cards WHERE id='1'").get().deleted, 1, 'last copy gone -> printing tombstoned');
console.log('sync copies stream test: PASS');
