const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureSalesSchema(db);
  ensureListingsSchema(db);
  return db;
}
// So liefert PostgREST: numeric als Text, date als 'YYYY-MM-DD', timestamptz mit Zone.
const LISTING = { listing_id: 'l1', channel_id: 'ebay', channel_name: 'eBay', title: 'T', description: null, price: '12.50', status: 'aktiv',
  listed_on: '2026-09-21', sale_id: null, external_url: null, note: null, created_at: '2026-09-21T10:00:00+00:00',
  updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };
const ITEM = { listing_id: 'l1', copy_id: 'c1', card_id: '1', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare', edition: 'first',
  condition: 'NM', name: 'Dunkler Magier', image_url: null, created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };

test('Abbildung: Preis als Zahl, Datum als Text, Booleans, keine Zeitstempel', () => {
  const l = Sync.remoteToLocalListing(LISTING);
  assert.equal(l.price, 12.5);
  assert.equal(l.listed_on, '2026-09-21');
  assert.equal(l.deleted, 0);
  assert.ok(!('updated_at' in l) && !('created_at' in l));
  const r = Sync.listingToRemote({ ...LISTING, price: 12.5, deleted: 1, updated_at: 'x', created_at: 'y' });
  assert.equal(r.deleted, true);
  assert.ok(!('updated_at' in r) && !('created_at' in r));
  assert.equal(Sync.listingItemToRemote({ ...ITEM, deleted: 0 }).deleted, false);
  assert.equal(Sync.remoteToLocalListingItem({ ...ITEM, deleted: true }).deleted, 1);
});

test('Pull legt Angebot und Position an, Echo wird übersprungen', () => {
  const db = freshDb();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  assert.equal(Sync._applyPulledListings(db, [LISTING]), 1);
  assert.equal(Sync._applyPulledListingItems(db, [ITEM]), 1);
  assert.equal(db.prepare('SELECT price FROM listings').get().price, 12.5);
  Sync._recentlyPushedListings.set('l1', LISTING.updated_at);
  assert.equal(Sync._applyPulledListings(db, [LISTING]), 0, 'Echo');
  Sync._recentlyPushedListingItems.set('l1|c1', ITEM.updated_at);
  assert.equal(Sync._applyPulledListingItems(db, [ITEM]), 0, 'Echo Position');
});

test('Gezogene Zeilen werden nicht zurückgeschoben (Fix I2), auch nicht nach einer Änderung', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listings_last_push', '2026-09-20T00:00:00Z'), ('sync_listing_items_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  Sync._applyPulledListings(db, [LISTING]);
  Sync._applyPulledListingItems(db, [ITEM]);
  Sync._applyPulledListings(db, [{ ...LISTING, status: 'beendet', updated_at: '2026-09-21T11:00:00+00:00' }]);
  assert.equal(db.prepare('SELECT status FROM listings').get().status, 'beendet');
  assert.deepEqual(Sync._salesPushRows(db, 'listings', '2026-09-20 00:00:00'), []);
  assert.deepEqual(Sync._salesPushRows(db, 'listing_items', '2026-09-20 00:00:00'), []);
});

test('Lokale Änderung wird geschoben', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, price, listed_on, updated_at)
    VALUES ('l2', 'ebay', 'eBay', 5, '2026-09-21', '2026-09-21 08:00:00')`).run();
  assert.deepEqual(Sync._salesPushRows(db, 'listings', '2026-09-20 00:00:00').map((r) => r.listing_id), ['l2']);
});

// Abschluss-Fix I1: ungeschobene lokale Angebots-Aenderungen gewinnen gegen den Pull.
const CURSORS = "INSERT INTO settings (key, value) VALUES ('sync_listings_last_push', '2026-09-21T09:00:00Z'), ('sync_listing_items_last_push', '2026-09-21T09:00:00Z'), ('sync_sales_last_push', '2026-09-21T09:00:00Z')";

test('I1: lokal ungeschoben + Remote älter -> Remote übersprungen, lokale Zeile wird geschoben', () => {
  const db = freshDb();
  db.prepare(CURSORS).run();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, title, price, status, listed_on, updated_at)
    VALUES ('l1', 'ebay', 'eBay', 'T', 20, 'beendet', '2026-09-21', '2026-09-21 12:00:00')`).run();
  db.prepare(`INSERT INTO listing_items (listing_id, copy_id, card_id, set_code, language, rarity, edition, condition, name, deleted, updated_at)
    VALUES ('l1', 'c1', '1', 'LOB-DE005', 'DE', 'Ultra Rare', 'first', 'NM', 'Dunkler Magier', 1, '2026-09-21 12:00:00')`).run();
  Sync._applyPulledListings(db, [LISTING]);
  Sync._applyPulledListingItems(db, [ITEM]);
  const l = db.prepare('SELECT status, price, updated_at FROM listings').get();
  assert.deepEqual(l, { status: 'beendet', price: 20, updated_at: '2026-09-21 12:00:00' });
  assert.equal(db.prepare('SELECT deleted FROM listing_items').get().deleted, 1);
  assert.deepEqual(Sync._salesPushRows(db, 'listings', '2026-09-21 09:00:00').map((r) => r.status), ['beendet']);
  assert.deepEqual(Sync._salesPushRows(db, 'listing_items', '2026-09-21 09:00:00').map((r) => r.deleted), [1]);
});

test('I1: lokal schon geschoben (updated_at <= Obergrenze) -> Remote wird angewandt', () => {
  const db = freshDb();
  db.prepare(CURSORS).run();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, title, price, status, listed_on, updated_at)
    VALUES ('l1', 'ebay', 'eBay', 'T', 20, 'beendet', '2026-09-21', '2026-09-21 09:00:00')`).run();
  Sync._applyPulledListings(db, [LISTING]);
  const l = db.prepare('SELECT status, price FROM listings').get();
  assert.deepEqual(l, { status: 'aktiv', price: 12.5 });
});

test('I1: H2-Tabelle sales ohne Flag -> Remote wird wie bisher angewandt', () => {
  const db = freshDb();
  db.prepare(CURSORS).run();
  Sync._recentlyPushedSales.clear();
  db.prepare(`INSERT INTO sales (sale_id, sold_on, channel_id, channel_name, gross, status, updated_at)
    VALUES ('s1', '2026-09-21', 'ebay', 'eBay', 99, 'aktiv', '2026-09-21 12:00:00')`).run();
  Sync._applyPulledSales(db, [{ sale_id: 's1', sold_on: '2026-09-21', channel_id: 'ebay', channel_name: 'eBay', gross: 10, fees: null,
    shipping: 1.6, status: 'aktiv', note: null, created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false }]);
  assert.equal(db.prepare('SELECT gross FROM sales').get().gross, 10);
});
