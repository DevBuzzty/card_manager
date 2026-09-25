const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');
const fs = require('fs');
const path = require('path');
const FIRST_ED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'valuation', 'first-ed.json'), 'utf8'));

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

test('listContainers bewertet 1st-Ed-Exemplare mit price_first_ed (Fixture valueOf)', () => {
  for (const c of FIRST_ED.valueOf) {
    const db = freshDb();
    addContainer(db, 'c1', 'Blau');
    // Erst den Preis (der Trigger rechnet price_first_ed aus dem leeren Faktor = NULL), dann price_first_ed
    // direkt: ein UPDATE nur dieser Spalte loest den 1st-Ed-Trigger nicht aus.
    db.prepare("UPDATE cards SET price = ? WHERE id = '46986414'").run(c.card.price);
    db.prepare("UPDATE cards SET price_first_ed = ? WHERE id = '46986414'").run(c.card.price_first_ed);
    const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, container_id)
                            VALUES (?, '46986414', 'LOB-DE005', 'DE', 'Common', ?, ?, 'c1')`);
    let n = 0;
    for (const cp of c.copies) for (let i = 0; i < (cp.count || 1); i++) ins.run(`k${n++}`, cp.edition, cp.condition);
    const [row] = copies.listContainers(db);
    assert.strictEqual(row.value, c.value, c.name);
  }
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

test('saveContainer erlaubt bei binder nur 4, 9 oder 12 Fächer pro Seite', () => {
  const db = freshDb();
  assert.throws(() => copies.saveContainer(db, { name: 'Blau', kind: 'binder', pockets_per_page: 7 }),
    /Fächer/);
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

// --- Fix-Durchlauf 1: deleteCopy loescht copy_id-genau (Befund A) --------------------------

test('deleteCopy loescht genau dieses Exemplar weich', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  copies.deleteCopy(db, { copy_id: 'k1' });
  assert.equal(readCopy(db, 'k1').deleted, 1);
});

test('deleteCopy laesst ein zweites Exemplar gleicher Edition/Zustand, aber anderem Standort, unversehrt', () => {
  // Genau der Fall aus Befund A: zwei NM/Unlimited-Exemplare, eines in Binder A, eines in
  // Binder B -- removeCopies waehlt ueber Edition/Zustand/created_at, nicht ueber copy_id, und
  // haette das falsche treffen koennen. deleteCopy ist copy_id-genau.
  const db = freshDb();
  addContainer(db, 'a', 'Binder A');
  addContainer(db, 'b', 'Binder B');
  addCopy(db, 'inA', { container_id: 'a', page: 1, slot: 1, note: 'Notiz A' });
  addCopy(db, 'inB', { container_id: 'b', page: 2, slot: 5, note: 'Notiz B' });
  copies.deleteCopy(db, { copy_id: 'inA' });
  assert.equal(readCopy(db, 'inA').deleted, 1);
  const b = readCopy(db, 'inB');
  assert.equal(b.deleted, 0, 'das andere Exemplar darf nicht geloescht werden');
  assert.equal(b.container_id, 'b');
  assert.equal(b.page, 2);
  assert.equal(b.slot, 5);
  assert.equal(b.note, 'Notiz B');
});

test('deleteCopy stempelt updated_at neu', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  db.prepare("UPDATE card_copies SET updated_at = '2000-01-01 00:00:00' WHERE copy_id = 'k1'").run();
  copies.deleteCopy(db, { copy_id: 'k1' });
  assert.notEqual(readCopy(db, 'k1').updated_at, '2000-01-01 00:00:00');
});

test('deleteCopy auf eine unbekannte copy_id wirft', () => {
  const db = freshDb();
  assert.throws(() => copies.deleteCopy(db, { copy_id: 'gibtsnicht' }));
});

test('deleteCopy schreibt cards.quantity/cards.deleted nicht selbst -- der Trigger erledigt das', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  copies.deleteCopy(db, { copy_id: 'k1' });
  const card = db.prepare('SELECT quantity, deleted FROM cards').get();
  assert.equal(card.quantity, 0, 'der Trigger muss die Karte auf 0 gesetzt haben');
  assert.equal(card.deleted, 1, 'der Trigger muss die Karte tombstonen');
});

// --- Fix-Durchlauf 1: listAllCopies liefert alle lebenden Exemplare in einer Abfrage (Befund 2) --

test('listAllCopies liefert nur lebende Exemplare', () => {
  const db = freshDb();
  addCopy(db, 'lebt1');
  addCopy(db, 'lebt2');
  addCopy(db, 'weg', { deleted: 1 });
  const ids = copies.listAllCopies(db).map(r => r.copy_id).sort();
  assert.deepEqual(ids, ['lebt1', 'lebt2']);
});

test('listAllCopies liefert ein Exemplar ohne Behaelter mit container_id = null', () => {
  const db = freshDb();
  addCopy(db, 'frei');
  const [row] = copies.listAllCopies(db);
  assert.equal(row.container_id, null);
});

test('listAllCopies traegt die Werte DES EXEMPLARS, nicht der Karte', () => {
  // Kein JOIN mit cards (Befund 2 warnt ausdruecklich vor der Spaltenkollision aus Befund 1) --
  // Testdaten so gebaut, dass sich Exemplar- und Kartenwerte nachweislich unterscheiden.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1', { container_id: 'c1', page: 2, slot: 4, tags: '["Kratzer"]', note: 'Ecke bestossen' });
  db.prepare(`UPDATE card_copies SET created_at = '2020-01-01 00:00:00' WHERE copy_id = 'k1'`).run();
  db.prepare(`UPDATE cards SET created_at = '2021-05-05 00:00:00' WHERE id = '46986414'`).run();
  const [row] = copies.listAllCopies(db);
  assert.equal(row.copy_id, 'k1');
  assert.equal(row.card_id, '46986414');
  assert.equal(row.set_code, 'LOB-DE005');
  assert.equal(row.language, 'DE');
  assert.equal(row.rarity, 'Common');
  assert.equal(row.container_id, 'c1');
  assert.equal(row.page, 2);
  assert.equal(row.slot, 4);
  assert.deepEqual(JSON.parse(row.tags), ['Kratzer']);
  assert.equal(row.note, 'Ecke bestossen');
  assert.equal(row.created_at, '2020-01-01 00:00:00', 'created_at muss das des Exemplars sein, nicht der Karte');
});

test('listAllCopies traegt Edition und Zustand mit (Spec B2 Task 8)', () => {
  // Die Binder-Ansicht rechnet daraus den Wert einer Ordnerseite (Preis x Zustandsfaktor) und
  // reicht dieselbe Zeile an CopySheet weiter, das beide Felder im Kopf zeigt. Fehlten sie,
  // waere der Faktor stumm 1 und der Sheet-Kopf leer.
  const db = freshDb();
  addCopy(db, 'k1');
  db.prepare(`UPDATE card_copies SET edition = 'first', condition = 'LP' WHERE copy_id = 'k1'`).run();
  const [row] = copies.listAllCopies(db);
  assert.equal(row.edition, 'first');
  assert.equal(row.condition, 'LP');
});

// --- Fix-Durchlauf Abschlussreview: saveContainer raeumt Seite/Fach beim Wechsel weg von binder (Befund 2) ---

test('saveContainer raeumt Seite und Fach aller Exemplare, wenn die Art von binder auf box wechselt', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau', 'binder', 9);
  addCopy(db, 'k1', { container_id: 'c1', page: 1, slot: 1 });
  addCopy(db, 'k2', { container_id: 'c1', page: 2, slot: 3 });
  copies.saveContainer(db, { container_id: 'c1', name: 'Blau', kind: 'box', pockets_per_page: null });
  const k1 = readCopy(db, 'k1'), k2 = readCopy(db, 'k2');
  assert.equal(k1.page, null); assert.equal(k1.slot, null);
  assert.equal(k2.page, null); assert.equal(k2.slot, null);
  assert.equal(k1.container_id, 'c1', 'der Behaelter selbst bleibt zugewiesen -- nur Seite/Fach werden geraeumt');
});

test('saveContainer laesst Seite und Fach in Ruhe, wenn die Art binder bleibt', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau', 'binder', 9);
  addCopy(db, 'k1', { container_id: 'c1', page: 1, slot: 1 });
  copies.saveContainer(db, { container_id: 'c1', name: 'Blau neu', kind: 'binder', pockets_per_page: 12 });
  const k1 = readCopy(db, 'k1');
  assert.equal(k1.page, 1);
  assert.equal(k1.slot, 1);
});

// --- Fix-Durchlauf Abschlussreview: listContainers meldet die hoechste belegte Seite (Befund 7) ---

test('listContainers liefert die hoechste belegte Seite, nicht ceil(Anzahl/Faecher)', () => {
  // Spec 5.3: liegen 10 Karten alle auf Seite 7 eines 9-Fach-Ordners, muss "7" herauskommen,
  // nicht ceil(10/9) = 2.
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  for (let i = 0; i < 10; i++) addCopy(db, `k${i}`, { container_id: 'c1', page: 7, slot: (i % 9) + 1 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, 7);
});

test('listContainers liefert keine belegte Seite, wenn kein Exemplar eine Seite traegt', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Leerer Ordner', 'binder', 9);
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, null);
});

// --- Abschluss-Fixwelle Minor 3: max_page rechnet ueber dieselbe Fachpruefung wie
// binderGrid.js#isPlaced, damit Liste und aufgeschlagener Ordner dieselbe Seitenzahl zeigen ---

test('listContainers zaehlt ein Exemplar ohne Fach nicht als Seite', () => {
  // Szenario 1 des Abschlussreviews: 12 Exemplare im 9er-Ordner, keines in einem Fach (alle ueber
  // "Aus Fach nehmen" abgelegt). Frueher meldete die Liste ueber den ceil-Rueckfall "2 Seiten",
  // waehrend der Ordner "Seite 1 von 1" zeigte und alle zwoelf unter "Ohne Fach" standen.
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  for (let i = 0; i < 12; i++) addCopy(db, `k${i}`, { container_id: 'c1' });
  const [row] = copies.listContainers(db);
  assert.equal(row.copies_count, 12);
  assert.equal(row.max_page, null);
});

test('listContainers zaehlt ein Fach jenseits der Ordnergroesse nicht mit', () => {
  // Szenario 2: Ordner von 12 auf 9 Faecher umgestellt, ein Exemplar steht noch auf S7/F11.
  // Das Raster kann Fach 11 nicht zeigen (binderGrid.js#isPlaced), also zaehlt es auch hier nicht:
  // die hoechste sichtbare Seite ist die 3.
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  addCopy(db, 'weit', { container_id: 'c1', page: 7, slot: 11 });
  addCopy(db, 'nah', { container_id: 'c1', page: 3, slot: 2 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, 3);
});

test('listContainers meldet gar keine Seite, wenn nur Faecher jenseits der Ordnergroesse belegt sind', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  addCopy(db, 'weit', { container_id: 'c1', page: 7, slot: 11 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, null, 'die einzige Karte liegt im Ordner unter "Ohne Fach"');
});

test('listContainers behandelt einen Ordner ohne Fachzahl wie einen 4er-Ordner', () => {
  // slotMath.js#clampPockets: alles, was nicht > 0 ist (auch NULL), gilt als 4er-Ordner. Eine
  // solche Zeile kann aus der Cloud stammen -- saveContainer selbst laesst sie nicht zu.
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner ohne Fachzahl', 'binder', null);
  addCopy(db, 'drin', { container_id: 'c1', page: 2, slot: 4 });
  addCopy(db, 'draussen', { container_id: 'c1', page: 5, slot: 5 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, 2);
});

test('listContainers laesst Seite 0 und Fach 0 nicht als belegt gelten', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  addCopy(db, 'k0', { container_id: 'c1', page: 0, slot: 1 });
  addCopy(db, 'k1', { container_id: 'c1', page: 1, slot: 0 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, null);
});

test('listContainers zaehlt nur lebende Exemplare als Seite', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner', 'binder', 9);
  addCopy(db, 'lebt', { container_id: 'c1', page: 2, slot: 1 });
  addCopy(db, 'weg', { container_id: 'c1', page: 9, slot: 1, deleted: 1 });
  const [row] = copies.listContainers(db);
  assert.equal(row.max_page, 2);
});

// Spec E1 §4: Exemplare fuer den Deck-Abgleich -- nur lebende Exemplare lebender Printings, mit Standort und Preisfeldern.
test('listDeckCopies liefert lebende Exemplare lebender Printings mit Standort und Preisen', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner Blau', 'binder', 9);
  db.prepare("UPDATE cards SET name = 'Dunkler Magier', price = 2.5, cm_first_ed_factor = 1.2 WHERE id = '46986414'").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','Unknown','DE','Unknown', 0)").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','SDY-DE006','DE','Common', 1)").run();
  addCopy(db, 'lebt', { container_id: 'c1', page: 3, slot: 2 });
  addCopy(db, 'weg', { deleted: 1 });
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity) VALUES
              ('unknown','46986414','Unknown','DE','Unknown'), ('printing-weg','46986414','SDY-DE006','DE','Common')`).run();
  // Erst nach dem Exemplar tombstonen: der Recount-Trigger belebt ein Printing beim Einfuegen eines Exemplars wieder.
  // Das JOIN auf c.deleted = 0 bleibt der Schutz fuer einen Pull, der das Printing geloescht herunterbringt.
  db.prepare("UPDATE cards SET deleted = 1 WHERE id = '46986414' AND set_code = 'SDY-DE006'").run();
  const rows = copies.listDeckCopies(db);
  assert.deepEqual(rows.map((r) => r.copy_id), ['lebt', 'unknown']);
  const [lebt] = rows;
  assert.equal(lebt.container_id, 'c1');
  assert.equal(lebt.page, 3);
  assert.equal(lebt.slot, 2);
  assert.equal(lebt.card_name, 'Dunkler Magier');
  assert.equal(lebt.price, 2.5);
  assert.equal(lebt.price_first_ed, 3);
  assert.equal(lebt.edition, 'unknown');
  assert.equal(lebt.condition, 'NM');
});

// Mehrfachauswahl (Plan 2026-09-26): verschieben in jede Behälterart, Rückgängig, schon im Ziel = unberührt.
test('relocateCopies: in eine Box, alte Standorte zurück, Rückgängig stellt Seite/Fach wieder her', () => {
  const db = freshDb();
  addContainer(db, 'b', 'Ordner A', 'binder');
  addContainer(db, 'x', 'Box Doppelte', 'box', null);
  addCopy(db, 'k1', { container_id: 'b', page: 2, slot: 5 });
  addCopy(db, 'k2');
  const moved = copies.relocateCopies(db, { copyIds: ['k1', 'k2'], containerId: 'x' });
  assert.deepEqual(moved.map((m) => [m.copy_id, m.container_id, m.page, m.slot]), [['k1', 'b', 2, 5], ['k2', null, null, null]]);
  assert.deepEqual(['k1', 'k2'].map((id) => { const r = readCopy(db, id); return [r.container_id, r.page, r.slot]; }), [['x', null, null], ['x', null, null]]);
  copies.restoreCopyLocations(db, moved);
  assert.deepEqual([readCopy(db, 'k1').container_id, readCopy(db, 'k1').page, readCopy(db, 'k1').slot, readCopy(db, 'k2').container_id], ['b', 2, 5, null]);
});

test('relocateCopies: heraus aus dem Behälter; wer schon im Ziel liegt, behält sein Fach', () => {
  const db = freshDb();
  addContainer(db, 'b', 'Ordner A', 'binder');
  addCopy(db, 'k1', { container_id: 'b', page: 1, slot: 1 });
  addCopy(db, 'k2', { container_id: 'b', page: 1, slot: 2 });
  assert.deepEqual(copies.relocateCopies(db, { copyIds: ['k1'], containerId: 'b' }), []);
  assert.equal(readCopy(db, 'k1').slot, 1);
  const moved = copies.relocateCopies(db, { copyIds: ['k2'], containerId: null });
  assert.equal(moved.length, 1);
  assert.deepEqual([readCopy(db, 'k2').container_id, readCopy(db, 'k2').slot], [null, null]);
});

test('relocateCopies: unbekanntes/gelöschtes Exemplar oder Behälter -> nichts geändert (eine Transaktion)', () => {
  const db = freshDb();
  addContainer(db, 'x', 'Box', 'box', null);
  addCopy(db, 'k1');
  addCopy(db, 'k2', { deleted: 1 });
  assert.throws(() => copies.relocateCopies(db, { copyIds: ['k1', 'k2'], containerId: 'x' }), /Exemplar nicht gefunden/);
  assert.equal(readCopy(db, 'k1').container_id, null, 'k1 wurde mit zurückgerollt');
  assert.throws(() => copies.relocateCopies(db, { copyIds: ['k1'], containerId: 'weg' }), /Behälter nicht gefunden/);
  assert.throws(() => copies.relocateCopies(db, { copyIds: [], containerId: 'x' }), /Keine Exemplare/);
});
