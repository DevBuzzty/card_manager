const assert = require('assert');
const Database = require('better-sqlite3');
const { rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow } = require('./sync.cjs');

// Local SQLite row -> remote upsert payload: booleans, only mirrored columns.
const local = { id: '1', set_code: 'LOB-EN001', language: 'DE', name: 'X',
  quantity: 3, deleted: 0, price: 1.5, rarity: 'Common', last_updated: 'x', created_at: 'y' };
const remote = rowToRemote(local);
assert.strictEqual(remote.deleted, false);
assert.strictEqual(remote.quantity, 3);
assert.strictEqual(remote.id, '1');
assert.ok(!('created_at' in remote), 'created_at is not mirrored');
assert.ok(!('updated_at' in remote), 'updated_at is server-stamped, never sent');

// New mirrored columns: cm_product_id passes through (null when unresolved), price_locked is an
// integer 0/1/2 (2 = manual) — never a boolean, never undefined.
assert.strictEqual(remote.cm_product_id, null, 'unresolved printing mirrors cm_product_id = null');
assert.strictEqual(remote.price_locked, 0, 'missing price_locked mirrors as 0');
const locked = rowToRemote({ ...local, cm_product_id: 102801, price_locked: 2 });
assert.strictEqual(locked.cm_product_id, 102801);
assert.strictEqual(locked.price_locked, 2, 'manual lock (2) survives the mapping');
assert.strictEqual(rowToRemote({ ...local, price_locked: 1 }).price_locked, 1);

// Remote row -> local patch: only quantity + deleted are applied (phone-owned fields).
const patch = remoteToLocalPatch({ id: '1', set_code: 'LOB-EN001', language: 'DE',
  quantity: 7, deleted: true, updated_at: '2026-01-01T00:00:00Z' });
assert.deepStrictEqual(patch, { id: '1', set_code: 'LOB-EN001', language: 'DE', quantity: 7, deleted: 1 });

// applyRemoteRow must not re-dirty a row whose quantity/deleted didn't actually change (F1):
// an unconditional UPDATE would fire trg_cards_updated, bump updated_at, and cause the next
// push to re-upload the desktop's stale price over the cloud's fresh one.
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', name TEXT, type TEXT, desc TEXT,
    image_url TEXT, atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
    quantity INTEGER DEFAULT 1, rarity TEXT, price REAL, deleted INTEGER DEFAULT 0,
    cm_product_id INTEGER, price_locked INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language)
  )`);
  db.exec(`
    CREATE TRIGGER trg AFTER UPDATE ON cards FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE cards SET updated_at = '2099-01-01 00:00:00' WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language; END;
  `);
  db.prepare(`INSERT INTO cards (id, set_code, language, quantity, deleted, price, cm_product_id, price_locked, updated_at)
    VALUES ('1', 'LOB-EN001', 'DE', 3, 0, 1.5, 123, 1, '2026-01-01 00:00:00')`).run();

  applyRemoteRow(db, { id: '1', set_code: 'LOB-EN001', language: 'DE', quantity: 3, deleted: false });
  let row = db.prepare("SELECT updated_at FROM cards WHERE id='1' AND set_code='LOB-EN001'").get();
  assert.strictEqual(row.updated_at, '2026-01-01 00:00:00', 'unchanged row must not be touched');

  applyRemoteRow(db, { id: '1', set_code: 'LOB-EN001', language: 'DE', quantity: 5, deleted: false });
  row = db.prepare("SELECT quantity, updated_at FROM cards WHERE id='1' AND set_code='LOB-EN001'").get();
  assert.strictEqual(row.quantity, 5, 'changed quantity applied');
  assert.strictEqual(row.updated_at, '2099-01-01 00:00:00', 'trigger fired only on real change');

  applyRemoteRow(db, { id: '2', set_code: 'X-1', language: 'DE', rarity: 'Common', quantity: 1, deleted: false, cm_product_id: 777, price_locked: 2 });
  const ins = db.prepare("SELECT cm_product_id, price_locked FROM cards WHERE id='2' AND set_code='X-1' AND language='DE'").get();
  assert.ok(ins, 'missing row was inserted');
  assert.strictEqual(ins.cm_product_id, 777, 'cm_product_id carried on insert');
  assert.strictEqual(ins.price_locked, 2, 'price_locked carried on insert');

  console.log('sync applyRemoteRow (F1) test: PASS');
}

console.log('sync mapping test: PASS');
