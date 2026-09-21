const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');

// Spec H1 §5.3/§6/§8 -- Verkaufsliste am Exemplar: Umschalten (idempotent, updated_at), Minus-Regel (markierte zuerst),
// Laden fuer Duplikate/Verkaufsliste (Haupt-Passcode), Deck-Abgleich traegt for_sale.
const P = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Common' };
const OLD = '2000-01-01 00:00:00';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    name TEXT, image_url TEXT,
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, image_url, price)
              VALUES ('46986414','LOB-DE005','DE','Common','Dunkler Magier','https://img/46986414.jpg', 2.0)`).run();
  return db;
}

const addCopy = (db, copyId, over = {}) =>
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, for_sale, deleted, created_at)
              VALUES (@copy_id, @card_id, @set_code, 'DE', @rarity, @edition, @condition, @for_sale, @deleted, @created_at)`)
    .run({ copy_id: copyId, card_id: '46986414', set_code: 'LOB-DE005', rarity: 'Common', edition: 'unknown', condition: 'NM',
      for_sale: 0, deleted: 0, created_at: '2026-09-01 10:00:00', ...over });
const readCopy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);
const live = (db) => db.prepare('SELECT copy_id FROM card_copies WHERE deleted = 0 ORDER BY copy_id').all().map((r) => r.copy_id);

test('setForSale markiert, setzt updated_at und ist idempotent', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  addCopy(db, 'k2');
  db.prepare('UPDATE card_copies SET updated_at = ?').run(OLD);
  assert.equal(copies.setForSale(db, { copyIds: ['k1', 'k2', 'k1'], value: true }), 2);
  assert.equal(readCopy(db, 'k1').for_sale, 1);
  assert.notEqual(readCopy(db, 'k1').updated_at, OLD, 'Umschalten stempelt updated_at (Sync)');
  db.prepare('UPDATE card_copies SET updated_at = ?').run(OLD);
  assert.equal(copies.setForSale(db, { copyIds: ['k1', 'k2'], value: true }), 0, 'zweiter gleicher Aufruf aendert nichts');
  assert.equal(readCopy(db, 'k1').updated_at, OLD, 'und stempelt nicht neu');
  assert.equal(copies.setForSale(db, { copyIds: ['k2'], value: false }), 1);
  assert.equal(readCopy(db, 'k2').for_sale, 0);
  assert.equal(readCopy(db, 'k1').for_sale, 1);
});

test('setForSale ueberspringt geloeschte und unbekannte Exemplare, prueft die Eingabe', () => {
  const db = freshDb();
  addCopy(db, 'weg', { deleted: 1 });
  assert.equal(copies.setForSale(db, { copyIds: ['weg', 'gibt-es-nicht'], value: true }), 0);
  assert.equal(readCopy(db, 'weg').for_sale, 0);
  assert.throws(() => copies.setForSale(db, { copyIds: 'k1', value: true }), copies.ValidationError);
  assert.throws(() => copies.setForSale(db, { copyIds: [''], value: true }), copies.ValidationError);
  assert.throws(() => copies.setForSale(db, { copyIds: ['k1'], value: 1 }), copies.ValidationError);
});

test('setForSale schreibt cards.quantity nie', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  addCopy(db, 'k2');
  db.prepare('UPDATE cards SET updated_at = ?').run(OLD);
  copies.setForSale(db, { copyIds: ['k1', 'k2'], value: true });
  const card = db.prepare('SELECT quantity, deleted, updated_at FROM cards WHERE id = ?').get('46986414');
  assert.deepEqual(card, { quantity: 2, deleted: 0, updated_at: OLD });
  assert.ok(!/UPDATE\s+cards/i.test(copies.setForSale.toString()), 'kein Schreibweg auf cards');
});

test('Minus mit Gruppe entfernt markierte Exemplare zuerst', () => {
  const db = freshDb();
  addCopy(db, 'alt-markiert', { for_sale: 1, created_at: '2026-09-01 10:00:00' });
  addCopy(db, 'neu', { created_at: '2026-09-05 10:00:00' });
  assert.equal(copies.removeCopies(db, P, { edition: 'unknown', condition: 'NM', count: 1 }), 1);
  assert.deepEqual(live(db), ['neu']);
});

test('Minus ohne Gruppe entfernt markierte Exemplare vor dem Standard', () => {
  const db = freshDb();
  addCopy(db, 'standard', { created_at: '2026-09-05 10:00:00' });
  addCopy(db, 'markiert-erste', { for_sale: 1, edition: 'first', condition: 'MT', created_at: '2026-09-01 10:00:00' });
  assert.equal(copies.removeCopies(db, P, { count: 1 }), 1);
  assert.deepEqual(live(db), ['standard']);
  assert.equal(db.prepare('SELECT quantity FROM cards WHERE id = ?').get('46986414').quantity, 1, 'Trigger zaehlt');
});

test('listSaleCopies: lebende Exemplare lebender Printings mit Preisfeldern und Haupt-Passcode', () => {
  const db = freshDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.5 WHERE id = '46986414'").run();
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, price)
              VALUES ('46986415','CT13-DE003','DE','Ultra Rare','Dunkler Magier', 3), ('89631139','SDK-DE001','DE','Ultra Rare','Blauäugiger w. Drache', 8)`).run();
  addCopy(db, 'k1', { for_sale: 1, edition: 'first', created_at: '2026-09-01 10:00:00' });
  addCopy(db, 'k2', { card_id: '46986415', set_code: 'CT13-DE003', rarity: 'Ultra Rare', created_at: '2026-09-02 10:00:00' });
  addCopy(db, 'k3', { card_id: '89631139', set_code: 'SDK-DE001', rarity: 'Ultra Rare', created_at: '2026-09-03 10:00:00' });
  addCopy(db, 'weg', { deleted: 1, created_at: '2026-09-04 10:00:00' });
  db.prepare("UPDATE card_copies SET container_id = 'c1', tags = '[\"Deck\"]', note = 'x' WHERE copy_id = 'k1'").run();
  const calls = [];
  const rows = copies.listSaleCopies(db, (id) => { calls.push(id); return id === '46986415' ? '46986414' : (id === '89631139' ? '' : null); });
  assert.deepEqual(rows.map((r) => [r.copy_id, r.main_id]), [['k1', '46986414'], ['k2', '46986414'], ['k3', '89631139']]);
  assert.deepEqual(calls, ['46986414', '46986415', '89631139'], 'je Passcode einmal nachgeschlagen');
  const [k1] = rows;
  assert.equal(k1.for_sale, 1);
  assert.equal(k1.name, 'Dunkler Magier');
  assert.equal(k1.image_url, 'https://img/46986414.jpg');
  assert.equal(k1.price, 2);
  assert.equal(k1.price_first_ed, 3);
  assert.equal(k1.container_id, 'c1');
  assert.equal(k1.tags, '["Deck"]');
  assert.equal(k1.note, 'x');
  assert.equal(k1.created_at, '2026-09-01 10:00:00');
  assert.equal(k1.edition, 'first');
});

test('listSaleCopies ohne Nachschlagen nimmt den gespeicherten Passcode, geloeschtes Printing faellt weg', () => {
  const db = freshDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','SDY-DE006','DE','Common', 1)").run();
  addCopy(db, 'k1');
  addCopy(db, 'printing-weg', { set_code: 'SDY-DE006' });
  db.prepare("UPDATE cards SET deleted = 1 WHERE set_code = 'SDY-DE006'").run();
  assert.deepEqual(copies.listSaleCopies(db).map((r) => [r.copy_id, r.main_id]), [['k1', '46986414']]);
});

test('listDeckCopies traegt for_sale fuer das Preisschild im Deckbuilder', () => {
  const db = freshDb();
  addCopy(db, 'k1', { for_sale: 1 });
  assert.equal(copies.listDeckCopies(db)[0].for_sale, 1);
});
