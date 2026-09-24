const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const { navCounts } = require('./nav-counts.cjs');

// Spec I1 Task 6 §3.1 -- Zaehler der Seitenleiste: offene Unbekannte (cards.set_code = 'Unknown'),
// vorgemerkte Exemplare (card_copies.for_sale = 1, nicht verkauft), laufende Angebote (listings.status = 'aktiv').
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  ensureSalesSchema(db);
  ensureListingsSchema(db);
  return db;
}

const addCard = (db, over = {}) => db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, price, deleted)
  VALUES (@id, @set_code, @language, 'Common', 'Karte', 1, @deleted)`).run({ id: '1', set_code: 'LOB-DE005', language: 'DE', deleted: 0, ...over });

const addCopy = (db, copyId, over = {}) => db.prepare(`INSERT INTO card_copies
  (copy_id, card_id, set_code, language, rarity, edition, condition, for_sale, sold_in, deleted)
  VALUES (@copy_id, @card_id, @set_code, 'DE', 'Common', 'unknown', 'NM', @for_sale, @sold_in, @deleted)`)
  .run({ copy_id: copyId, card_id: '1', set_code: 'LOB-DE005', for_sale: 0, sold_in: null, deleted: 0, ...over });

const addListing = (db, id, over = {}) => db.prepare(`INSERT INTO listings
  (listing_id, channel_id, channel_name, price, status, listed_on, deleted)
  VALUES (@listing_id, 'ebay', 'eBay', 5, @status, '2026-09-23', @deleted)`)
  .run({ listing_id: id, status: 'aktiv', deleted: 0, ...over });

// Spec H3a §4.1 (listings-schema.cjs): listing_items verknuepft Angebot <-> Exemplar ueber copy_id.
const addListingItem = (db, listingId, copyId, over = {}) => db.prepare(`INSERT INTO listing_items
  (listing_id, copy_id, card_id, set_code, language, rarity, edition, condition, deleted)
  VALUES (@listing_id, @copy_id, '1', 'LOB-DE005', 'DE', 'Common', 'unknown', 'NM', @deleted)`)
  .run({ listing_id: listingId, copy_id: copyId, deleted: 0, ...over });

test('navCounts zaehlt offene Unbekannte, vorgemerkte Exemplare und laufende Angebote', () => {
  const db = freshDb();
  addCard(db, { id: '1', set_code: 'Unknown' });
  addCard(db, { id: '2', set_code: 'MAMO-DE072' });
  addCopy(db, 'vorgemerkt', { for_sale: 1 });
  addCopy(db, 'verkauft', { for_sale: 1, sold_in: 'v1' });
  addListing(db, 'aktiv1', { status: 'aktiv' });
  addListing(db, 'beendet1', { status: 'beendet' });

  assert.deepEqual(navCounts(db), { unknown: 1, forSale: 1, listingsOpen: 1 });
});

test('navCounts ignoriert geloeschte Unbekannte, Exemplare und Angebote', () => {
  const db = freshDb();
  addCard(db, { id: '1', set_code: 'Unknown', deleted: 1 });
  addCopy(db, 'weg', { for_sale: 1, deleted: 1 });
  addListing(db, 'weg1', { status: 'aktiv', deleted: 1 });

  assert.deepEqual(navCounts(db), { unknown: 0, forSale: 0, listingsOpen: 0 });
});

test('navCounts liefert Nullen ohne Tabellen (Fehler abgefangen)', () => {
  const db = new Database(':memory:');
  assert.deepEqual(navCounts(db), { unknown: 0, forSale: 0, listingsOpen: 0 });
});

// Fixrunde 1 (Review Task 6, Important): ein vorgemerktes Exemplar in einem AKTIVEN Angebot zaehlt
// nicht doppelt -- es steckt bereits in listingsOpen, forSale muss es dafuer auslassen.
test('navCounts: vorgemerktes Exemplar in aktivem Angebot zaehlt nur bei listingsOpen, nicht bei forSale', () => {
  const db = freshDb();
  addCard(db);
  addCopy(db, 'im-angebot', { for_sale: 1 });
  addListing(db, 'L1', { status: 'aktiv' });
  addListingItem(db, 'L1', 'im-angebot');

  assert.deepEqual(navCounts(db), { unknown: 0, forSale: 0, listingsOpen: 1 });
});

// Ein BEENDETES Angebot blockt forSale nicht -- das Exemplar ist wieder "frei" vorgemerkt.
test('navCounts: vorgemerktes Exemplar in beendetem Angebot zaehlt wieder bei forSale', () => {
  const db = freshDb();
  addCard(db);
  addCopy(db, 'beendet-angebot', { for_sale: 1 });
  addListing(db, 'L2', { status: 'beendet' });
  addListingItem(db, 'L2', 'beendet-angebot');

  assert.deepEqual(navCounts(db), { unknown: 0, forSale: 1, listingsOpen: 0 });
});

// Fixrunde 1 (Info 4): zwei 'Unknown'-Zeilen derselben Karte (z.B. zwei Sprachen) zaehlen als EINE
// Karte -- der Nutzer sieht in Scannen eine Kachel pro Passcode, nicht pro Zeile.
test('navCounts: zwei Unbekannt-Zeilen derselben Karte in verschiedenen Sprachen zaehlen als eine Karte', () => {
  const db = freshDb();
  addCard(db, { id: '1', set_code: 'Unknown', language: 'DE' });
  addCard(db, { id: '1', set_code: 'Unknown', language: 'JP' });

  assert.equal(navCounts(db).unknown, 1);
});
