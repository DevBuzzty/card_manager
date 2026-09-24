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

// Fixrunde 1 §2: updated_at/last_run_at springen bei jedem Lauf der Cloud-Funktion, auch ohne inhaltliche
// Aenderung -- nur eine echte Inhaltsaenderung soll ebay-changed ausloesen.
test('ebay_status: nur updated_at/last_run_at aendern sich -> keine Aenderung gemeldet, Zwischenspeicher bleibt frisch', async () => {
  const db = freshDb();
  const S1 = { environment: 'sandbox', connected: true, updated_at: '2026-09-22T12:00:00+00:00', last_run_at: '2026-09-22T12:00:00+00:00' };
  assert.equal(await Sync._pullEbayStatus(fakeClient([S1]), db), true);
  const S2 = { ...S1, updated_at: '2026-09-22T12:05:00+00:00', last_run_at: '2026-09-22T12:05:00+00:00' };
  assert.equal(await Sync._pullEbayStatus(fakeClient([S2]), db), false);
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ebay_status_cache'").get().value), S2);
  const S3 = { ...S2, connected: false, updated_at: '2026-09-22T12:10:00+00:00' };
  assert.equal(await Sync._pullEbayStatus(fakeClient([S3]), db), true);
});

// Fixrunde 1 §3: syncNow (als testbare Kernlogik syncNowCore) muss Push-Fehler und Zeitueberschreitung melden
// statt sie zu verschlucken; bei beidem darf der Aufrufer ebay-sync NICHT anstossen (main.cjs prueft `ok`).
test('syncNowCore: Erfolg, Fehlschlag und Zeitueberschreitung', async () => {
  const okResult = await Sync._syncNowCore(async () => {}, () => false, 5000);
  assert.deepEqual(okResult, { ok: true });

  const failResult = await Sync._syncNowCore(async () => { throw new Error('push kaputt'); }, () => false, 5000);
  assert.deepEqual(failResult, { ok: false, error: Sync._SYNC_NOW_FAILED_MSG });

  const slowCycle = () => new Promise((r) => setTimeout(r, 300));
  const timeoutResult = await Sync._syncNowCore(slowCycle, () => false, 30);
  assert.deepEqual(timeoutResult, { ok: false, error: Sync._SYNC_NOW_TIMEOUT_MSG });

  // Ein bereits laufender Zyklus wird abgewartet (Zeitlimit gilt fuer die gesamte Wartezeit inklusive).
  let stillRunning = true;
  setTimeout(() => { stillRunning = false; }, 20);
  const waitedResult = await Sync._syncNowCore(async () => {}, () => stillRunning, 5000);
  assert.deepEqual(waitedResult, { ok: true });

  const neverStops = await Sync._syncNowCore(async () => {}, () => true, 30);
  assert.deepEqual(neverStops, { ok: false, error: Sync._SYNC_NOW_TIMEOUT_MSG });
});

// Abschluss-Fix B1: ein Push-Fehler je Tabelle wird nicht mehr verschluckt, sondern als false gemeldet.
test('pushTablesSafe: alle Tabellen versucht, Fehlschlag gemeldet', async () => {
  const seen = [];
  const ok = await Sync._pushTablesSafe(['a', 'b', 'c'], async (t) => { seen.push(t); });
  assert.equal(ok, true);
  const seen2 = [];
  const origError = console.error;
  console.error = () => {};
  let failed;
  try {
    failed = await Sync._pushTablesSafe(['a', 'b', 'c'], async (t) => { seen2.push(t); if (t === 'b') throw new Error('kaputt'); });
  } finally { console.error = origError; }
  assert.equal(failed, false);
  assert.deepEqual([seen, seen2], [['a', 'b', 'c'], ['a', 'b', 'c']], 'die anderen Tabellen laufen weiter');
});

// Abschluss-Fix B2: vor dem ersten Ziehen "pending" statt null (sonst roter Fehler + "wartet auf eBay" beim Start).
test('ebayStatusReply: noch nie gezogen -> pending; danach Stand bzw. null', () => {
  assert.deepEqual(Sync.ebayStatusReply(null, false), { status: null, pending: true });
  assert.deepEqual(Sync.ebayStatusReply(null, true), { status: null });
  assert.deepEqual(Sync.ebayStatusReply('null', false), { status: null });
  assert.deepEqual(Sync.ebayStatusReply('{"connected":true}', false), { status: { connected: true } });
  assert.deepEqual(Sync.ebayStatusReply('kaputt', true), { status: null });
});

// Plan H3b2 Task 7 -- Bestellungen und Hinweise als Nur-Lese-Ströme; Wahrheitswerte/Beträge aus Postgres umgewandelt.
test('ebay_orders und sale_notices: Nur-Lese-Ströme, true/false -> 1/0, numeric-Text -> Zahl, nie geschoben', async () => {
  const db = freshDb();
  const O = { order_id: 'O-1', environment: 'production', sale_id: 'ebay-production-O-1', status: 'gebucht', fees_provisional: '0.72',
    fees_final: false, raw_total: '6.60', error: null, created_at: '2026-09-24T10:00:00+00:00', updated_at: '2026-09-24T10:00:01+00:00' };
  assert.equal(await Sync._pullReadOnlyTable(fakeClient([[O]]), db, 'ebay_orders'), 1);
  assert.deepEqual(db.prepare('SELECT sale_id, fees_provisional, fees_final, raw_total FROM ebay_orders').get(),
    { sale_id: 'ebay-production-O-1', fees_provisional: 0.72, fees_final: 0, raw_total: 6.6 });
  const N = { notice_id: 'ship-x', kind: 'shipping', text: 'Versandkosten nachtragen', sale_id: 'x', listing_id: null, dismissed: true,
    created_at: '2026-09-24T10:00:00+00:00', updated_at: '2026-09-24T10:00:01+00:00' };
  const c = fakeClient([[N]]);
  assert.equal(await Sync._pullReadOnlyTable(c, db, 'sale_notices'), 1);
  assert.equal(db.prepare('SELECT dismissed FROM sale_notices').get().dismissed, 1);
  assert.deepEqual(c.calls.filter((m) => ['upsert', 'insert', 'update', 'delete'].includes(m)), []);
  for (const t of ['ebay_orders', 'sale_notices']) {
    assert.ok(Sync._READ_ONLY_TABLES.includes(t), t);
    assert.ok(!Sync._PUSHED_TABLES.includes(t), t);
  }
});
