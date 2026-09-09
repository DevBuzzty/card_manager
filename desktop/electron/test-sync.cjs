const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { rowToRemote, remoteToLocalPatch, remoteToLocalFull, applyRemoteRow,
  _recentlyPushedContainers, _applyPulledContainers } = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');

// Local SQLite row -> remote upsert payload: booleans, only mirrored columns.
const local = { id: '1', set_code: 'LOB-EN001', language: 'DE', name: 'X',
  quantity: 3, deleted: 0, price: 1.5, rarity: 'Common', last_updated: 'x', created_at: 'y' };
const remote = rowToRemote(local);
assert.strictEqual(remote.deleted, false);
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

// applyRemoteRow must not re-dirty a row whose quantity/deleted didn't actually change (F1):
// an unconditional UPDATE would fire trg_cards_updated, bump updated_at, and cause the next
// push to re-upload the desktop's stale price over the cloud's fresh one.
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', name TEXT, type TEXT, desc TEXT,
    image_url TEXT, atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
    quantity INTEGER DEFAULT 1, rarity TEXT, price REAL, deleted INTEGER DEFAULT 0,
    cm_product_id INTEGER, price_locked INTEGER DEFAULT 0, price_first_ed REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity)
  )`);
  db.exec(`
    CREATE TRIGGER trg AFTER UPDATE ON cards FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE cards SET updated_at = '2099-01-01 00:00:00' WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language; END;
  `);
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, quantity, deleted, price, cm_product_id, price_locked, updated_at)
    VALUES ('1', 'LOB-EN001', 'DE', 'Common', 3, 0, 1.5, 123, 1, '2026-01-01 00:00:00')`).run();

  applyRemoteRow(db, { id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', quantity: 3, deleted: false });
  let row = db.prepare("SELECT updated_at FROM cards WHERE id='1' AND set_code='LOB-EN001'").get();
  assert.strictEqual(row.updated_at, '2026-01-01 00:00:00', 'unchanged row must not be touched');

  applyRemoteRow(db, { id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', quantity: 5, deleted: true });
  row = db.prepare("SELECT quantity, deleted, updated_at FROM cards WHERE id='1' AND set_code='LOB-EN001'").get();
  assert.strictEqual(row.quantity, 3, 'quantity is NOT patched from remote any more');
  assert.strictEqual(row.deleted, 1, 'deleted applied');
  assert.strictEqual(row.updated_at, '2099-01-01 00:00:00', 'trigger fired only on real change');

  applyRemoteRow(db, { id: '2', set_code: 'X-1', language: 'DE', rarity: 'Common', quantity: 1, deleted: false, cm_product_id: 777, price_locked: 2 });
  const ins = db.prepare("SELECT cm_product_id, price_locked FROM cards WHERE id='2' AND set_code='X-1' AND language='DE'").get();
  assert.ok(ins, 'missing row was inserted');
  assert.strictEqual(ins.cm_product_id, 777, 'cm_product_id carried on insert');
  assert.strictEqual(ins.price_locked, 2, 'price_locked carried on insert');

  console.log('sync applyRemoteRow (F1) test: PASS');
}

// Spec A: quantity is derived from copies on both sides -> never pushed; patch carries rarity + deleted only.
assert.ok(!('quantity' in rowToRemote(local)), 'quantity must not be pushed');
assert.deepStrictEqual(
  remoteToLocalPatch({ id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', quantity: 7, deleted: true }),
  { id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', deleted: 1 });
{
  const { copyToRemote, remoteToLocalCopy } = require('./sync.cjs');
  const c = copyToRemote({ copy_id: 'u1', card_id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', edition: 'first', condition: 'GD',
    deleted: 0, container_id: null, page: null, slot: null, tags: null, note: null, needs_review: 0, review_reason: null, for_sale: 0, created_at: 'x', updated_at: 'y' });
  assert.strictEqual(c.deleted, false); assert.strictEqual(c.needs_review, false); assert.strictEqual(c.for_sale, false);
  assert.ok(!('updated_at' in c) && !('created_at' in c), 'timestamps are not pushed');
  assert.strictEqual(c.edition, 'first');
  const l = remoteToLocalCopy({ copy_id: 'u1', card_id: '1', set_code: 'LOB-EN001', language: 'DE', rarity: 'Common', edition: 'first', condition: 'GD', deleted: true, needs_review: false, for_sale: true, updated_at: 'z' });
  assert.strictEqual(l.deleted, 1); assert.strictEqual(l.for_sale, 1); assert.strictEqual(l.needs_review, 0);
}

console.log('sync mapping test: PASS');

// Behaelter als dritter Sync-Strom (Spec B1 Task 2). Ein card_copies-Eintrag darf nie auf einen
// Behaelter zeigen, den es lokal noch nicht gibt -- es gibt bewusst keinen Fremdschluessel dafuer
// (siehe containers-schema.cjs), die Zugreihenfolge in cycle() ist die einzige Absicherung.

function freshSyncDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT,
      price REAL, language TEXT DEFAULT 'DE', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER DEFAULT 0, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);
  `);
  ensureCopiesSchema(db); // creates card_copies + price_history; containers' index needs card_copies first
  ensureContainersSchema(db);
  return db;
}

// Ordnungstest: startSync() selbst gegen eine Attrappe laufen zu lassen wuerde entweder eine
// echte Supabase-Verbindung brauchen (verboten in Tests) oder dessen produktive setInterval/
// setTimeout-Zeitgeber lostreten, die den Testprozess offen halten. Der kleinste Weg, der die
// Reihenfolge wirklich prueft, ohne einen neuen Netzwerk-Test-Zugang einzufuehren: den Quelltext
// von cycle() lesen und die Aufrufreihenfolge der vier Stromfunktionen textuell verifizieren.
{
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  const start = src.indexOf('async function cycle(');
  const end = src.indexOf('setInterval(cycle', start);
  assert.ok(start >= 0 && end > start, 'cycle() muss gefunden werden');
  const body = src.slice(start, end);
  const iPullC = body.indexOf('pullContainers(c)');
  const iPullK = body.indexOf('pullCopies(c)');
  const iPushC = body.indexOf('pushContainers(c)');
  const iPushK = body.indexOf('pushCopies(c)');
  assert.ok(iPullC >= 0 && iPullC < iPullK, 'pullContainers muss vor pullCopies laufen');
  assert.ok(iPushC >= 0 && iPushC < iPushK, 'pushContainers muss vor pushCopies laufen');
  console.log('sync cycle order (Behaelter vor Exemplaren) test: PASS');
}

// Echo-Sperre: ein gepushter Behaelter wird beim naechsten Pull nicht erneut angewandt.
{
  const db = freshSyncDb();
  _recentlyPushedContainers.clear();
  _recentlyPushedContainers.set('c1', '2026-09-09T10:00:00Z');
  const applied = _applyPulledContainers(db, [
    { container_id: 'c1', name: 'Blau', kind: 'binder', updated_at: '2026-09-09T10:00:00Z' },
  ]);
  assert.equal(applied, 0);
  assert.equal(_recentlyPushedContainers.has('c1'), false, 'Echo-Eintrag muss verbraucht sein');
  console.log('sync containers echo-lock test: PASS');
}

// Ein fremd (auf dem Handy) geaenderter Behaelter wird angewandt, auch wenn er zuvor gepusht wurde.
{
  const db = freshSyncDb();
  _recentlyPushedContainers.clear();
  _recentlyPushedContainers.set('c1', '2026-09-09T10:00:00Z');
  const applied = _applyPulledContainers(db, [
    { container_id: 'c1', name: 'Blau neu', kind: 'binder', updated_at: '2026-09-09T11:00:00Z' },
  ]);
  assert.equal(applied, 1);
  assert.equal(db.prepare('SELECT name FROM containers WHERE container_id = ?').get('c1').name, 'Blau neu');
  console.log('sync containers foreign-change test: PASS');
}

// deleted kommt aus Supabase als Boolean und wird lokal zu 0/1.
{
  const db = freshSyncDb();
  _recentlyPushedContainers.clear();
  _applyPulledContainers(db, [
    { container_id: 'c1', name: 'Blau', kind: 'binder', deleted: true, updated_at: '2026-09-09T10:00:00Z' },
  ]);
  assert.equal(db.prepare('SELECT deleted FROM containers WHERE container_id = ?').get('c1').deleted, 1);
  console.log('sync containers deleted boolean test: PASS');
}
