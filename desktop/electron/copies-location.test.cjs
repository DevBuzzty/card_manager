const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');

function freshDb() {
  const db = new Database(':memory:');
  // portfolio_history muss vor ensureCopiesSchema existieren: sie haengt dort per
  // addColumnIfMissing eine Spalte an (siehe copies-schema.cjs) -- derselbe Grund, aus dem
  // containers-schema.test.cjs (Task 1) die Tabelle in seiner freshDb() mit anlegt.
  // name/image_url/created_at/updated_at ergaenzt (ueber das Minimum hinaus), damit
  // listUnsortedCopies' card_name/card_image_url-Spalten und die created_at/updated_at-
  // Kollisionstests gegen ein realistisches cards-Schema laufen (siehe database.cjs).
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    name TEXT, image_url TEXT,
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, price)
              VALUES ('46986414','LOB-DE005','DE','Common', 2.0)`).run();
  return db;
}

const addContainer = (db, id, name, kind = 'binder', pockets = 9) =>
  db.prepare(`INSERT INTO containers (container_id, name, kind, pockets_per_page)
              VALUES (?,?,?,?)`).run(id, name, kind, pockets);

const addCopy = (db, copyId, over = {}) =>
  db.prepare(`INSERT INTO card_copies
       (copy_id, card_id, set_code, language, rarity, container_id, page, slot, tags, note, deleted)
       VALUES (@copy_id,'46986414','LOB-DE005','DE','Common',
               @container_id,@page,@slot,@tags,@note,@deleted)`)
    .run({ copy_id: copyId, container_id: null, page: null, slot: null,
           tags: null, note: null, deleted: 0, ...over });

const readCopy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);

test('setCopyLocation setzt Behaelter, Seite und Fach', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, 'c1');
  assert.equal(k.page, 3);
  assert.equal(k.slot, 7);
});

test('setCopyLocation mit null raeumt auch Seite und Fach', () => {
  // Sonst bliebe eine verwaiste Seite/Fach-Angabe an einem Exemplar ohne Behaelter stehen.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1', { container_id: 'c1', page: 3, slot: 7 });
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: null, page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, null);
  assert.equal(k.page, null);
  assert.equal(k.slot, null);
});

test('bei box und deckbox werden Seite und Fach immer verworfen', () => {
  // Der Aufrufer darf sie schicken; die Regel liegt hier, nicht in der Oberflaeche.
  const db = freshDb();
  addContainer(db, 'b1', 'Alte Box', 'box', null);
  addCopy(db, 'k1');
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'b1', page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, 'b1');
  assert.equal(k.page, null);
  assert.equal(k.slot, null);
});

test('setCopyLocation auf einen unbekannten Behaelter wirft', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  assert.throws(() => copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'gibtsnicht' }));
  assert.equal(readCopy(db, 'k1').container_id, null, 'nichts darf geschrieben worden sein');
});

test('setCopyLocation stempelt updated_at neu', () => {
  // Ohne frisches updated_at holt der Sync die Aenderung nie ab -- er zieht ueber updated_at > cursor.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  db.prepare("UPDATE card_copies SET updated_at = '2000-01-01 00:00:00' WHERE copy_id = 'k1'").run();
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 1, slot: 1 });
  assert.notEqual(readCopy(db, 'k1').updated_at, '2000-01-01 00:00:00');
});

test('setCopyTagsNote schreibt Tags und Notiz und laesst den Standort in Ruhe', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1', { container_id: 'c1', page: 2, slot: 4 });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: ['Kratzer', 'Tausch'], note: 'Ecke bestossen' });
  const k = readCopy(db, 'k1');
  assert.deepEqual(JSON.parse(k.tags), ['Kratzer', 'Tausch']);
  assert.equal(k.note, 'Ecke bestossen');
  assert.equal(k.container_id, 'c1', 'Standort darf nicht angefasst werden');
  assert.equal(k.page, 2);
  assert.equal(k.slot, 4);
});

test('setCopyTagsNote mit leerer Tag-Liste schreibt NULL, nicht "[]"', () => {
  // "keine Tags" muss in der Datenbank genau eine Darstellung haben.
  const db = freshDb();
  addCopy(db, 'k1', { tags: '["Alt"]' });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: [], note: null });
  assert.equal(readCopy(db, 'k1').tags, null);
});

test('listUnsortedCopies liefert nur lebende Exemplare ohne Behaelter', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'frei1');
  addCopy(db, 'frei2');
  addCopy(db, 'einsortiert', { container_id: 'c1', page: 1, slot: 1 });
  addCopy(db, 'geloescht', { deleted: 1 });
  const ids = copies.listUnsortedCopies(db).map(r => r.copy_id).sort();
  assert.deepEqual(ids, ['frei1', 'frei2']);
});

test('listTags entdoppelt ueber Exemplare hinweg und ignoriert geloeschte', () => {
  const db = freshDb();
  addCopy(db, 'k1', { tags: '["Tausch","Kratzer"]' });
  addCopy(db, 'k2', { tags: '["tausch"]' });                 // gleiche Schreibweise ignorieren
  addCopy(db, 'k3', { tags: '["Nur im geloeschten"]', deleted: 1 });
  addCopy(db, 'k4', { tags: 'kaputt' });                      // darf nicht werfen
  const tags = copies.listTags(db);
  assert.deepEqual(tags, ['Kratzer', 'Tausch'], 'entdoppelt und alphabetisch');
});

test('listContainers zaehlt nur lebende Exemplare und ueberspringt geloeschte Behaelter', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addContainer(db, 'c2', 'Weg');
  db.prepare("UPDATE containers SET deleted = 1 WHERE container_id = 'c2'").run();
  addCopy(db, 'k1', { container_id: 'c1', page: 1, slot: 1 });
  addCopy(db, 'k2', { container_id: 'c1', page: 1, slot: 2 });
  addCopy(db, 'k3', { container_id: 'c1', page: 1, slot: 3, deleted: 1 });
  const list = copies.listContainers(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].container_id, 'c1');
  assert.equal(list[0].copies_count, 2, 'das geloeschte Exemplar zaehlt nicht mit');
});

test('kein Helfer schreibt jemals cards.quantity oder cards.deleted', () => {
  // Beide sind triggergepflegte Caches. Ein Schreibzugriff aus Anwendungscode wuerde sie
  // stillschweigend von den echten Exemplaren entkoppeln.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  const vorher = db.prepare('SELECT quantity, deleted FROM cards').get();
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 1, slot: 1 });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: ['X'], note: 'Y' });
  const nachher = db.prepare('SELECT quantity, deleted FROM cards').get();
  assert.deepEqual(nachher, vorher);
});

// --- Fix-Durchlauf 1: Spaltenkollision in listUnsortedCopies (Befund 1) ---------------------

test('listUnsortedCopies liefert created_at/updated_at DES EXEMPLARS, nicht der Karte', () => {
  // Regression: SELECT cp.*, c.* liess die gleichnamigen c.-Spalten die cp.-Spalten
  // ueberschreiben (better-sqlite3 baut das Ergebnisobjekt spaltenweise auf, letzte Spalte
  // gewinnt) -- Testdaten so gebaut, dass sich Exemplar- und Kartenwerte nachweislich unterscheiden.
  const db = freshDb();
  addCopy(db, 'frei1');
  db.prepare(`UPDATE card_copies SET created_at = '2020-01-01 00:00:00', updated_at = '2020-01-02 00:00:00'
              WHERE copy_id = 'frei1'`).run();
  db.prepare(`UPDATE cards SET created_at = '2021-05-05 00:00:00', updated_at = '2021-06-06 00:00:00'
              WHERE id = '46986414'`).run();
  const [row] = copies.listUnsortedCopies(db);
  assert.equal(row.created_at, '2020-01-01 00:00:00', 'created_at muss das des Exemplars sein, nicht der Karte');
  assert.equal(row.updated_at, '2020-01-02 00:00:00', 'updated_at muss das des Exemplars sein, nicht der Karte');
});

test('listUnsortedCopies liefert deleted DES EXEMPLARS, nicht der Karte', () => {
  const db = freshDb();
  addCopy(db, 'frei1');
  const [row] = copies.listUnsortedCopies(db);
  assert.equal(row.deleted, 0, 'deleted muss aus card_copies stammen, nicht aus cards');
});

// --- Fix-Durchlauf 1: saveContainer validiert und meldet deutsch (Befund 2) -----------------

test('saveContainer lehnt einen leeren (auch nur aus Leerraum bestehenden) Namen ab', () => {
  const db = freshDb();
  assert.throws(() => copies.saveContainer(db, { name: '   ', kind: 'binder', pockets_per_page: 9 }),
    /Name/);
});

test('saveContainer speichert den beschnittenen Namen, nicht den rohen', () => {
  const db = freshDb();
  const id = copies.saveContainer(db, { name: '  Blau  ', kind: 'binder', pockets_per_page: 9 });
  assert.equal(db.prepare('SELECT name FROM containers WHERE container_id = ?').get(id).name, 'Blau');
});

test('saveContainer lehnt eine unbekannte Behaelterart ab', () => {
  const db = freshDb();
  assert.throws(() => copies.saveContainer(db, { name: 'Blau', kind: 'karton', pockets_per_page: 9 }),
    /Behälterart/);
});

test('saveContainer erlaubt bei binder nur 4, 9 oder 12 Taschen pro Seite', () => {
  const db = freshDb();
  assert.throws(() => copies.saveContainer(db, { name: 'Blau', kind: 'binder', pockets_per_page: 7 }),
    /Taschen/);
});

test('saveContainer verwirft pockets_per_page bei box, statt es abzulehnen', () => {
  // Box und Deckbox haben keine Seiten -- dieselbe Bauart wie setCopyLocation es mit page/slot macht.
  const db = freshDb();
  const id = copies.saveContainer(db, { name: 'Karton', kind: 'box', pockets_per_page: 9 });
  assert.equal(db.prepare('SELECT pockets_per_page FROM containers WHERE container_id = ?').get(id).pockets_per_page, null);
});

// --- Fix-Durchlauf 1: saveContainer meldet nicht faelschlich Erfolg (Befund 3) --------------

test('saveContainer wirft bei unbekannter oder geloeschter container_id, statt {success:true} vorzutaeuschen', () => {
  const db = freshDb();
  addContainer(db, 'weg', 'Alt');
  db.prepare("UPDATE containers SET deleted = 1 WHERE container_id = 'weg'").run();
  assert.throws(() => copies.saveContainer(db, { container_id: 'weg', name: 'Neu', kind: 'binder', pockets_per_page: 9 }));
  assert.throws(() => copies.saveContainer(db, { container_id: 'gibtsnicht', name: 'Neu', kind: 'binder', pockets_per_page: 9 }));
});

// --- Fix-Durchlauf 1: setCopyLocation/setCopyTagsNote melden nicht faelschlich Erfolg (Befund 4) --

test('setCopyLocation wirft bei unbekanntem copy_id, statt {success:true} vorzutaeuschen', () => {
  const db = freshDb();
  assert.throws(() => copies.setCopyLocation(db, { copy_id: 'gibtsnicht', container_id: null }));
});

test('setCopyTagsNote wirft bei unbekanntem copy_id, statt {success:true} vorzutaeuschen', () => {
  const db = freshDb();
  assert.throws(() => copies.setCopyTagsNote(db, { copy_id: 'gibtsnicht', tags: [], note: null }));
});
