const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const { ensureEbaySchema } = require('./ebay-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db); ensureSalesSchema(db); ensureListingsSchema(db); ensureEbaySchema(db);
  return db;
}
// Nachgebauter Supabase-Client: nur Lese-Ketten; jeder Aufruf wird protokolliert (Wächter gegen Schreiben).
function fakeClient(pages) {
  const calls = [];
  const q = {};
  for (const m of ['select', 'gt', 'order', 'eq']) q[m] = (...a) => { calls.push(m); return q; };
  for (const m of ['upsert', 'insert', 'update', 'delete']) q[m] = () => { calls.push(m); return q; };
  q.range = () => { calls.push('range'); return Promise.resolve({ data: pages.shift() ?? [], error: null }); };
  q.maybeSingle = () => { calls.push('maybeSingle'); return Promise.resolve({ data: pages.shift() ?? null, error: null }); };
  return { calls, from: (t) => { calls.push(`from:${t}`); return q; } };
}
const ROW = { listing_id: 'l1', environment: 'sandbox', state: 'online', sku: 'L-l1', offer_id: 'O1', item_id: 'I2',
  item_url: 'https://sandbox.ebay.de/itm/I2', published_qty: 2, synced_hash: 'h', failed_hash: null, sold_seen: 0, error: null,
  synced_at: '2026-09-22T12:00:00+00:00', created_at: '2026-09-22T12:00:00+00:00', updated_at: '2026-09-22T12:00:00.5+00:00' };

test('ebay_listings: Nur-Lese-Strom übernimmt Zeilen wörtlich, setzt den Zeiger und schreibt nie', async () => {
  const db = freshDb();
  const c = fakeClient([[ROW, { ...ROW, listing_id: 'l2', state: 'fehler', error: 'Merkmal fehlt', updated_at: '2026-09-22T12:01:00+00:00' }]]);
  assert.equal(await Sync._pullReadOnlyTable(c, db, 'ebay_listings'), 2);
  assert.deepEqual(db.prepare('SELECT listing_id, state, error, published_qty FROM ebay_listings ORDER BY listing_id').all(),
    [{ listing_id: 'l1', state: 'online', error: null, published_qty: 2 }, { listing_id: 'l2', state: 'fehler', error: 'Merkmal fehlt', published_qty: 2 }]);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sync_ebay_listings_last_pull'").get().value, '2026-09-22T12:01:00+00:00');
  assert.deepEqual(c.calls.filter((m) => ['upsert', 'insert', 'update', 'delete'].includes(m)), []);
  const again = fakeClient([[{ ...ROW, state: 'beendet', updated_at: '2026-09-22T13:00:00+00:00' }]]);
  await Sync._pullReadOnlyTable(again, db, 'ebay_listings');
  assert.equal(db.prepare("SELECT state FROM ebay_listings WHERE listing_id = 'l1'").get().state, 'beendet');
});

test('Wächter: Nur-Lese-Tabellen werden nie geschoben', () => {
  for (const t of [...Sync._READ_ONLY_TABLES, 'ebay_status', 'ebay_account']) assert.ok(!Sync._PUSHED_TABLES.includes(t), t);
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  assert.doesNotMatch(src, /from\((['"`])ebay_(listings|status|account)\1\)\s*\.\s*(upsert|insert|update|delete)/);
});

test('ebay_status: Zwischenspeicher nur bei Änderung, leerer Stand = null', async () => {
  const db = freshDb();
  const S = { environment: 'sandbox', connected: true, has_payment_policy: true };
  assert.equal(await Sync._pullEbayStatus(fakeClient([S]), db), true);
  assert.equal(await Sync._pullEbayStatus(fakeClient([{ ...S }]), db), false);
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ebay_status_cache'").get().value), S);
  assert.equal(await Sync._pullEbayStatus(fakeClient([null]), db), true);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ebay_status_cache'").get().value, 'null');
});

const PHOTO = { photo_id: 'p1', listing_id: 'l1', path: 'l1/p1.jpg', sort: 2, created_at: '2026-09-22T10:00:00+00:00',
  updated_at: '2026-09-22T10:00:01.5+00:00', deleted: false };

test('listing_photos: Abbildung, Echo, gezogene Zeilen nicht zurückschieben, lokale Änderung schieben', () => {
  const db = freshDb();
  const l = Sync.remoteToLocalListingPhoto(PHOTO);
  assert.deepEqual(l, { photo_id: 'p1', listing_id: 'l1', path: 'l1/p1.jpg', sort: 2, deleted: 0 });
  assert.equal(Sync.listingPhotoToRemote({ ...PHOTO, deleted: 1 }).deleted, true);
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listing_photos_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedListingPhotos.clear();
  assert.equal(Sync._applyPulledListingPhotos(db, [PHOTO]), 1);
  assert.deepEqual(Sync._salesPushRows(db, 'listing_photos', '2026-09-20 00:00:00'), []);
  Sync._recentlyPushedListingPhotos.set('p1', PHOTO.updated_at);
  assert.equal(Sync._applyPulledListingPhotos(db, [PHOTO]), 0, 'Echo');
  db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort, updated_at) VALUES ('p2', 'l1', 'l1/p2.jpg', 0, '2026-09-21 08:00:00')").run();
  assert.deepEqual(Sync._salesPushRows(db, 'listing_photos', '2026-09-20 00:00:00').map((r) => r.photo_id), ['p2']);
});

test('listing_photos: lokal ungeschoben gewinnt gegen den Pull (localWinsUnpushed)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listing_photos_last_push', '2026-09-21T00:00:00Z')").run();
  db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort, deleted, updated_at) VALUES ('p1', 'l1', 'l1/p1.jpg', 0, 1, '2026-09-22 09:00:00')").run();
  Sync._recentlyPushedListingPhotos.clear();
  Sync._applyPulledListingPhotos(db, [{ ...PHOTO, sort: 5 }]);
  assert.deepEqual(db.prepare("SELECT sort, deleted FROM listing_photos WHERE photo_id = 'p1'").get(), { sort: 0, deleted: 1 });
});
