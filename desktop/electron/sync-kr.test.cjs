// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-kr.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { rowToRemote, remoteToLocalFull, applyRemoteRow } = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', name TEXT, type TEXT, desc TEXT,
      image_url TEXT, atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT, quantity INTEGER DEFAULT 0,
      rarity TEXT, price REAL, deleted INTEGER DEFAULT 0, cm_product_id INTEGER, price_locked INTEGER DEFAULT 0,
      last_updated DATETIME, updated_at DATETIME, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  return db;
}

test('Schema bekommt name_ko und cm_lang_factor', () => {
  const db = makeDb();
  const cols = db.prepare('PRAGMA table_info(cards)').all().map(c => c.name);
  assert.ok(cols.includes('name_ko'));
  assert.ok(cols.includes('cm_lang_factor'));
});

test('Push-Payload und Insert-Payload tragen beide Felder (fehlend = null)', () => {
  const r = rowToRemote({ id: '1', set_code: 'CORI-KR001', language: 'KR', name_ko: '블랙 매지션', cm_lang_factor: 0.5 });
  assert.strictEqual(r.name_ko, '블랙 매지션');
  assert.strictEqual(r.cm_lang_factor, 0.5);
  const e = rowToRemote({ id: '1', set_code: 'X', language: 'DE' });
  assert.strictEqual(e.name_ko, null);
  assert.strictEqual(e.cm_lang_factor, null);
  const l = remoteToLocalFull({ id: '1', set_code: 'CORI-KR001', language: 'KR', name_ko: 'x', cm_lang_factor: 0.5 });
  assert.strictEqual(l.name_ko, 'x');
  assert.strictEqual(l.cm_lang_factor, 0.5);
});

test('Vom Handy angelegte KR-Zeile wird beim Einfuegen auf den PC-Faktor umgerechnet', () => {
  const db = makeDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('kr_price_factor', '0.6')").run();
  applyRemoteRow(db, { id: '9', set_code: 'CORI-KR001', language: 'KR', rarity: 'Common', deleted: false, price: 5, cm_lang_factor: 0.5, name_ko: '블랙' });
  const r = db.prepare("SELECT price, cm_lang_factor, name_ko FROM cards WHERE id='9'").get();
  assert.deepStrictEqual(r, { price: 6, cm_lang_factor: 0.6, name_ko: '블랙' });
});

test('Vom Handy angelegte DE-Zeile bleibt unveraendert', () => {
  const db = makeDb();
  applyRemoteRow(db, { id: '8', set_code: 'CORI-DE001', language: 'DE', rarity: 'Common', deleted: false, price: 5 });
  const r = db.prepare("SELECT price, cm_lang_factor FROM cards WHERE id='8'").get();
  assert.deepStrictEqual(r, { price: 5, cm_lang_factor: null });
});
