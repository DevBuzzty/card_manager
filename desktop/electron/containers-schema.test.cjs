const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema, deleteContainer } = require('./containers-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  return db;
}

const insertContainer = (db, id, name, kind = 'binder', pockets = 9) =>
  db.prepare(`INSERT INTO containers (container_id, name, kind, pockets_per_page)
              VALUES (?, ?, ?, ?)`).run(id, name, kind, pockets);

const insertCopy = (db, copyId, containerId, page, slot) =>
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, container_id, page, slot)
              VALUES (?, '46986414', 'LOB-DE005', 'DE', 'Common', ?, ?, ?)`)
    .run(copyId, containerId, page, slot);

test('ensureContainersSchema ist idempotent', () => {
  const db = freshDb();
  ensureContainersSchema(db);   // zweimal aufrufen darf nicht werfen
  const cols = db.prepare('PRAGMA table_info(containers)').all().map(c => c.name);
  for (const c of ['container_id', 'name', 'kind', 'pockets_per_page', 'color',
                   'sort_order', 'created_at', 'updated_at', 'deleted']) {
    assert.ok(cols.includes(c), 'Spalte fehlt: ' + c);
  }
});

test('kind ist auf die drei erlaubten Werte beschraenkt', () => {
  const db = freshDb();
  assert.throws(() => insertContainer(db, 'c1', 'Falsch', 'karton', null));
  assert.doesNotThrow(() => insertContainer(db, 'c2', 'Kiste', 'box', null));
  assert.doesNotThrow(() => insertContainer(db, 'c3', 'Deckbox', 'deckbox', null));
});

test('der Standort-Index auf card_copies existiert', () => {
  const db = freshDb();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='card_copies'")
    .all().map(r => r.name);
  assert.ok(idx.includes('card_copies_location_idx'), 'Index fehlt: ' + idx.join(', '));
});

test('deleteContainer raeumt die Standorte seiner Exemplare ab', () => {
  const db = freshDb();
  insertContainer(db, 'c1', 'Blau');
  insertCopy(db, 'k1', 'c1', 3, 7);
  insertCopy(db, 'k2', 'c1', 3, 8);
  insertCopy(db, 'k3', null, null, null);

  const geraeumt = deleteContainer(db, 'c1');
  assert.equal(geraeumt, 2);

  const row = db.prepare('SELECT deleted FROM containers WHERE container_id = ?').get('c1');
  assert.equal(row.deleted, 1, 'Behaelter muss soft-geloescht sein, nicht entfernt');

  const copies = db.prepare('SELECT copy_id, container_id, page, slot FROM card_copies ORDER BY copy_id').all();
  for (const c of copies) {
    assert.equal(c.container_id, null);
    assert.equal(c.page, null);
    assert.equal(c.slot, null);
  }
});

test('deleteContainer stempelt updated_at auf beiden Seiten neu', () => {
  const db = freshDb();
  insertContainer(db, 'c1', 'Blau');
  insertCopy(db, 'k1', 'c1', 1, 1);
  db.prepare("UPDATE containers SET updated_at = '2000-01-01 00:00:00' WHERE container_id = 'c1'").run();
  db.prepare("UPDATE card_copies SET updated_at = '2000-01-01 00:00:00' WHERE copy_id = 'k1'").run();

  deleteContainer(db, 'c1');

  const c = db.prepare('SELECT updated_at FROM containers WHERE container_id = ?').get('c1');
  const k = db.prepare('SELECT updated_at FROM card_copies WHERE copy_id = ?').get('k1');
  assert.notEqual(c.updated_at, '2000-01-01 00:00:00', 'Behaelter wuerde sonst nie gepusht');
  assert.notEqual(k.updated_at, '2000-01-01 00:00:00', 'Exemplar wuerde sonst nie gepusht');
});

test('deleteContainer rollt beide Updates zurueck, wenn eines mitten in der Transaktion scheitert', () => {
  const db = freshDb();
  insertContainer(db, 'c1', 'Blau');
  insertCopy(db, 'k1', 'c1', 3, 7);

  // Trigger simuliert einen Fehler, der erst beim zweiten UPDATE (containers) auftritt --
  // NACHDEM card_copies schon geraeumt worden waere, wenn deleteContainer nicht atomar waere.
  db.exec(`
    CREATE TRIGGER guard_c1_delete BEFORE UPDATE OF deleted ON containers
    WHEN NEW.container_id = 'c1' AND NEW.deleted = 1
    BEGIN SELECT RAISE(ABORT, 'simulierter Fehler'); END;
  `);

  assert.throws(() => deleteContainer(db, 'c1'));

  const copy = db.prepare('SELECT container_id, page, slot FROM card_copies WHERE copy_id = ?').get('k1');
  assert.equal(copy.container_id, 'c1', 'Standort waere sonst schon geraeumt, obwohl der Behaelter nicht geloescht wurde');
  assert.equal(copy.page, 3);
  assert.equal(copy.slot, 7);

  const row = db.prepare('SELECT deleted FROM containers WHERE container_id = ?').get('c1');
  assert.equal(row.deleted, 0, 'Behaelter darf nicht als geloescht stehen bleiben');
});

test('deleteContainer eines unbekannten Behaelters tut nichts und wirft nicht', () => {
  const db = freshDb();
  assert.equal(deleteContainer(db, 'gibtsnicht'), 0);
});
