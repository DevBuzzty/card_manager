const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');
const {
  DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck,
  FORMAT_SAVE_FAILED, saveDeckRows, saveDeck,
} = require('./decks.cjs');

// Attrappe des Supabase-Clients: merkt sich jede Schreibung; `fail` bestimmt je Tabelle, welche card_id/query scheitert.
function fakeClient({ fail = {}, updateError = null } = {}) {
  const calls = { wishlist: [], deal_watches: [], updates: [] };
  return {
    calls,
    from(table) {
      return {
        insert: async (row) => {
          calls[table].push(row);
          const key = table === 'wishlist' ? row.card_id : row.query;
          return { error: (fail[table] || []).includes(key) ? { message: 'kaputt' } : null };
        },
        update: (row) => ({ eq: async (col, val) => { calls.updates.push({ table, row, col, val }); return { error: updateError }; } }),
      };
    },
  };
}

test('Fehlende auf die Wunschliste: Cloud-Suche genau einmal, Watch nur mit Preis', async () => {
  const c = fakeClient();
  let scrapes = 0;
  const res = await addMissingToWishlist(c, [
    { card_id: '23434538', name: 'Maxx "C"', image_url: 'u1', max_price: 10.79 },
    { card_id: '10045474', name: 'Unendliche Vergänglichkeit', image_url: null, max_price: null },
    { card_id: '24224830', name: 'Vom Friedhof gerufen', image_url: 'u3', max_price: 0.42 },
  ], () => { scrapes += 1; });
  assert.equal(scrapes, 1);
  assert.deepEqual(res, { total: 3, added: 3, watches: 2, failed: [] });
  assert.deepEqual(c.calls.wishlist.map((r) => [r.card_id, r.max_price]), [['23434538', 10.79], ['10045474', null], ['24224830', 0.42]]);
  assert.deepEqual(c.calls.deal_watches, [{ query: 'Maxx "C"', max_price: 10.79 }, { query: 'Vom Friedhof gerufen', max_price: 0.42 }]);
});

test('Fehlende auf die Wunschliste: ohne Preise keine Cloud-Suche, Teilfehler gezählt', async () => {
  const c = fakeClient({ fail: { wishlist: ['2'] } });
  let scrapes = 0;
  const res = await addMissingToWishlist(c, [
    { card_id: '1', name: 'A', max_price: null },
    { card_id: '2', name: 'B', max_price: 3 },
  ], () => { scrapes += 1; });
  assert.equal(scrapes, 0);
  assert.deepEqual(res, { total: 2, added: 1, watches: 0, failed: ['2'] });
  assert.equal(c.calls.deal_watches.length, 0, 'gescheiterter Eintrag bekommt keinen Watch');
});

test('Fehlende auf die Wunschliste: ohne echten Namen kein Deal-Watch und keine Cloud-Suche', async () => {
  const c = fakeClient();
  let scrapes = 0;
  const res = await addMissingToWishlist(c, [
    { card_id: '12345678', name: '', max_price: 5 },
  ], () => { scrapes += 1; });
  assert.equal(scrapes, 0);
  assert.deepEqual(res, { total: 1, added: 1, watches: 0, failed: [] });
  assert.deepEqual(c.calls.wishlist, [{ card_id: '12345678', name: '12345678', image_url: null, max_price: 5 }]);
  assert.equal(c.calls.deal_watches.length, 0, 'Passcode als Name darf keinen Deal-Watch anlegen');
});

test('Deckbox zuordnen: Unique-Verletzung wird zur deutschen Meldung', async () => {
  assert.equal(deckContainerErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "decks_container_unique"' }), DECKBOX_TAKEN);
  assert.equal(deckContainerErrorMessage({ code: '42501', message: 'permission denied' }), 'permission denied');
  const taken = fakeClient({ updateError: { code: '23505', message: 'duplicate key' } });
  assert.deepEqual(await setDeckContainer(taken, { deckId: 7, containerId: 'box-rot' }), { success: false, error: DECKBOX_TAKEN });
  const ok = fakeClient();
  assert.deepEqual(await setDeckContainer(ok, { deckId: 7, containerId: '' }), { success: true });
  assert.deepEqual(ok.calls.updates, [{ table: 'decks', row: { container_id: null }, col: 'id', val: 7 }]);
});

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('14558127','RA01-DE008','DE','Common', 4.5)").run();
  db.prepare("INSERT INTO containers (container_id, name, kind, pockets_per_page) VALUES ('box-rot','Deckbox Rot','deckbox',NULL), ('ordner-blau','Ordner Blau','binder',9)").run();
  return db;
}

test('In die Box verschieben: Seite und Fach geleert, Fehlschlag nur für seine Zeile', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, container_id, page, slot)
              VALUES ('k1','14558127','RA01-DE008','DE','Common','ordner-blau',3,2)`).run();
  const res = moveCopiesToContainer(db, { copyIds: ['k1', 'gibt-es-nicht'], containerId: 'box-rot' }, (e) => e.message);
  assert.deepEqual(res, [
    { copy_id: 'k1', success: true },
    { copy_id: 'gibt-es-nicht', success: false, error: 'Exemplar nicht gefunden.' },
  ]);
  const k1 = db.prepare("SELECT container_id, page, slot FROM card_copies WHERE copy_id = 'k1'").get();
  assert.deepEqual({ ...k1 }, { container_id: 'box-rot', page: null, slot: null });
});

test('In die Box verschieben: nur in eine lebende Deckbox', () => {
  const db = freshDb();
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: 'ordner-blau' }, (e) => e.message), copies.ValidationError);
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: null }, (e) => e.message), copies.ValidationError);
});

// Spec E2 §5 -- Attrappe fuer den Import: decks.insert().select().single(), deck_cards.insert(), decks.delete().eq().
function importClient({ deckError = null, cardsError = null } = {}) {
  const calls = { decks: [], deck_cards: [], deleted: [] };
  return {
    calls,
    from(table) {
      return {
        insert: (row) => {
          calls[table].push(row);
          if (table === 'decks') {
            return { select: () => ({ single: async () => (deckError ? { data: null, error: deckError } : { data: { id: 42, ...row }, error: null }) }) };
          }
          return Promise.resolve({ error: cardsError });
        },
        delete: () => ({ eq: async (col, val) => { calls.deleted.push({ table, col, val }); return { error: null }; } }),
      };
    },
  };
}

const IMPORT = {
  name: 'Tenpai',
  notes: 'Nicht übernommen beim Import:\nJinzu',
  cards: [
    { card_id: '14558127', name: 'Asche-Blüte & Freudiger Frühling', count: 3, section: 'main' },
    { card_id: '1861629', name: 'Decode Talker', count: 1, section: 'extra' },
  ],
};

test('Import anlegen: Deck mit Notizen, alle Karten in einem Insert mit Katalogbild', async () => {
  const c = importClient();
  const res = await createImportedDeck(c, IMPORT, (id) => (id === '14558127' ? 'https://img/14558127.jpg' : null));
  assert.deepEqual(res, { success: true, deck: { id: 42, name: 'Tenpai', notes: 'Nicht übernommen beim Import:\nJinzu' } });
  assert.deepEqual(c.calls.decks, [{ name: 'Tenpai', notes: 'Nicht übernommen beim Import:\nJinzu' }]);
  assert.deepEqual(c.calls.deck_cards, [[
    { deck_id: 42, card_id: '14558127', name: 'Asche-Blüte & Freudiger Frühling', image_url: 'https://img/14558127.jpg', count: 3, section: 'main' },
    { deck_id: 42, card_id: '1861629', name: 'Decode Talker', image_url: null, count: 1, section: 'extra' },
  ]]);
  assert.deepEqual(c.calls.deleted, []);
});

test('Import anlegen: ohne Nicht-Übernommenes keine notes-Spalte im Insert', async () => {
  const c = importClient();
  await createImportedDeck(c, { ...IMPORT, notes: null });
  assert.deepEqual(c.calls.decks, [{ name: 'Tenpai' }]);
});

test('Import anlegen: scheitern die Karten, wird das leere Deck wieder gelöscht', async () => {
  const c = importClient({ cardsError: { message: 'violates check constraint' } });
  const res = await createImportedDeck(c, IMPORT);
  assert.deepEqual(res, { success: false, error: 'violates check constraint' });
  assert.deepEqual(c.calls.deleted, [{ table: 'decks', col: 'id', val: 42 }]);
});

test('Import anlegen: scheitert schon das Deck, wird nichts eingefügt und nichts gelöscht', async () => {
  const c = importClient({ deckError: { message: "Could not find the 'notes' column" } });
  const res = await createImportedDeck(c, IMPORT);
  assert.deepEqual(res, { success: false, error: "Could not find the 'notes' column" });
  assert.deepEqual(c.calls.deck_cards, []);
  assert.deepEqual(c.calls.deleted, []);
});

test('YDK-Datei: Antwortform { canceled, name, text } für den gemeinsamen Parser', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ydk-')), 'Tenpai Dragon.ydk');
  fs.writeFileSync(file, '#main\n14558127\n!side\n');
  assert.deepEqual(readYdkFile(file), { canceled: false, name: 'Tenpai Dragon', text: '#main\n14558127\n!side\n' });
});

// Spec E3 §6/§8 -- Attrappe fuer "Save Deck": deck_cards.delete().eq(), deck_cards.insert(rows), decks.update().eq().
// insertErrors: Fehler je Insert-Aufruf in Reihenfolge; updateErrors: Fehler je Update-Feld (notes/format).
function saveClient({ insertErrors = [], updateErrors = {} } = {}) {
  const calls = { deleted: [], inserts: [], updates: [] };
  return {
    calls,
    from(table) {
      return {
        delete: () => ({ eq: async (col, val) => { calls.deleted.push({ table, col, val }); return { error: null }; } }),
        insert: async (rows) => { calls.inserts.push(rows); return { error: insertErrors[calls.inserts.length - 1] || null }; },
        update: (patch) => ({
          eq: async (col, val) => {
            calls.updates.push({ table, patch, col, val });
            return { error: updateErrors[Object.keys(patch)[0]] || null };
          },
        }),
      };
    },
  };
}

const SAVE_CARDS = [
  { id: '14558127', type: 'main', quantity: 3, name: 'Asche-Blüte', image_url: 'a.jpg', role: 'starter' },
  { id: '1861629', type: 'extra', quantity: 1, name: 'Decode Talker', image_url: null, role: 'starter' },
  { id: '27204311', type: 'side', quantity: 2, name: null, image_url: null, role: null },
];

test('Save Deck: role nur an Starter-Zeilen des Main Decks, Name/Bild mit lokalem Rückfall', () => {
  const rows = saveDeckRows(7, SAVE_CARDS, (id) => (id === '27204311' ? { name: 'Nibiru', image_url: 'n.jpg' } : null));
  assert.deepEqual(rows, [
    { deck_id: 7, card_id: '14558127', name: 'Asche-Blüte', image_url: 'a.jpg', count: 3, section: 'main', role: 'starter' },
    { deck_id: 7, card_id: '1861629', name: 'Decode Talker', image_url: null, count: 1, section: 'extra' },
    { deck_id: 7, card_id: '27204311', name: 'Nibiru', image_url: 'n.jpg', count: 2, section: 'side' },
  ]);
});

test('Save Deck: löscht, fügt mit role ein und schreibt das geänderte Format', async () => {
  const c = saveClient();
  const res = await saveDeck(c, { deckId: 7, cards: SAVE_CARDS, notes: undefined, format: 'ocg' });
  assert.deepEqual(res, { success: true, roleSaved: true });
  assert.deepEqual(c.calls.deleted, [{ table: 'deck_cards', col: 'deck_id', val: 7 }]);
  assert.equal(c.calls.inserts.length, 1);
  assert.equal(c.calls.inserts[0][0].role, 'starter');
  assert.deepEqual(c.calls.updates, [{ table: 'decks', patch: { format: 'ocg' }, col: 'id', val: 7 }]);
});

test('Save Deck: ohne Format- und Notizänderung kein Update, ohne Sterne keine role-Spalte', async () => {
  const c = saveClient();
  await saveDeck(c, { deckId: 7, cards: [{ ...SAVE_CARDS[0], role: null }] });
  assert.deepEqual(c.calls.updates, []);
  assert.equal('role' in c.calls.inserts[0][0], false);
});

test('Save Deck: fehlt die Spalte role, landen die Karten ohne Sterne statt verloren zu gehen', async () => {
  const c = saveClient({ insertErrors: [{ message: "Could not find the 'role' column of 'deck_cards'" }] });
  const res = await saveDeck(c, { deckId: 7, cards: SAVE_CARDS });
  assert.deepEqual(res, { success: true, roleSaved: false });
  assert.equal(c.calls.inserts.length, 2);
  assert.equal(c.calls.inserts[1].some((r) => 'role' in r), false);
  assert.equal(c.calls.inserts[1].length, 3);
});

test('Save Deck: scheitert auch der Insert ohne role, kommt die Rohmeldung', async () => {
  const c = saveClient({ insertErrors: [{ message: 'kaputt' }, { message: 'immer noch kaputt' }] });
  await assert.rejects(saveDeck(c, { deckId: 7, cards: SAVE_CARDS }), { message: 'immer noch kaputt' });
});

test('Save Deck: fehlt die Spalte format, meldet es "Format konnte nicht gespeichert werden"', async () => {
  const c = saveClient({ updateErrors: { format: { message: "Could not find the 'format' column of 'decks'" } } });
  await assert.rejects(saveDeck(c, { deckId: 7, cards: [], notes: 'Notiz', format: 'free' }), { message: FORMAT_SAVE_FAILED });
  assert.equal(FORMAT_SAVE_FAILED, 'Format konnte nicht gespeichert werden');
  assert.deepEqual(c.calls.updates.map((u) => u.patch), [{ notes: 'Notiz' }, { format: 'free' }]);
});
