const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  // Wie copies-for-sale.test.cjs: ensureCopiesSchema braucht cards (mit price) und portfolio_history.
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureSalesSchema(db);
  return db;
}
const SALE = { sale_id: 's1', sold_on: '2026-09-21', channel_id: 'ebay', channel_name: 'eBay', gross: 10, fees: null, shipping: 1.6,
  status: 'aktiv', note: null, created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };
const ITEM = { sale_id: 's1', copy_id: 'c1', value_at_sale: 3, share: 8.4, was_for_sale: true, card_id: '1', set_code: 'LOB-DE001',
  language: 'DE', rarity: 'Common', edition: 'unknown', condition: 'NM', name: 'X', image_url: null,
  created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };

test('Abbildung: Booleans, keine Zeitstempel, Datum bleibt Text', () => {
  const r = Sync.saleToRemote({ ...SALE, deleted: 0, created_at: 'x', updated_at: 'y' });
  assert.equal(r.deleted, false);
  assert.equal(r.sold_on, '2026-09-21');
  assert.ok(!('updated_at' in r) && !('created_at' in r));
  assert.equal(Sync.itemToRemote({ ...ITEM, was_for_sale: 1, deleted: 0 }).was_for_sale, true);
  assert.equal(Sync.remoteToLocalItem(ITEM).was_for_sale, 1);
  assert.ok(!('updated_at' in Sync.remoteToLocalSale(SALE)));
});

test('Pull legt Verkauf und Position an, Echo wird uebersprungen', () => {
  const db = freshDb();
  Sync._recentlyPushedSales.clear(); Sync._recentlyPushedItems.clear();
  assert.equal(Sync._applyPulledSales(db, [SALE]), 1);
  assert.equal(Sync._applyPulledItems(db, [ITEM]), 1);
  assert.equal(db.prepare('SELECT share FROM sale_items').get().share, 8.4);
  Sync._recentlyPushedSales.set('s1', SALE.updated_at);
  assert.equal(Sync._applyPulledSales(db, [SALE]), 0, 'Echo');
  Sync._recentlyPushedItems.set('s1|c1', ITEM.updated_at);
  assert.equal(Sync._applyPulledItems(db, [ITEM]), 0, 'Echo Position');
});

test('Gezogene Zeile wird nicht zurueckgeschoben (Fix I2)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_sales_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedSales.clear();
  Sync._applyPulledSales(db, [SALE]);
  assert.deepEqual(Sync._salesPushRows(db, 'sales', '2026-09-20 00:00:00'), []);
});

test('Kanaele: feste Kanaele werden ohne Aenderung nicht geschoben', () => {
  const db = freshDb();
  assert.deepEqual(Sync._salesPushRows(db, 'sale_channels', '1970-01-01 00:00:00'), []);
});

test('sold_in reist im Exemplar-Strom mit', () => {
  const r = Sync.copyToRemote({ copy_id: 'c1', card_id: '1', set_code: 'X', language: 'DE', rarity: 'Common', edition: 'unknown',
    condition: 'NM', deleted: 1, for_sale: 0, needs_review: 0, sold_in: 's1' });
  assert.equal(r.sold_in, 's1');
  assert.equal(Sync.remoteToLocalCopy({ copy_id: 'c1', card_id: '1', sold_in: null }).sold_in, null);
});

// ---- Abschluss-Fixwelle I1: Handy-Verkauf kommt am PC an ----------------------------------------------
const Sales = require('./sales.cjs');
const COPY = { copy_id: 'c1', card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Common', edition: 'unknown', condition: 'NM',
  deleted: false, container_id: null, page: null, slot: null, tags: null, note: null, needs_review: false, review_reason: null,
  for_sale: true, sold_in: null, updated_at: '2026-09-21T10:00:02+00:00' };
function dbWithLiveCopy() {
  const db = freshDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, name, price) VALUES ('1', 'LOB-DE001', 'DE', 'Common', 'X', 3)").run();
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, condition, for_sale)
    VALUES ('c1', '1', 'LOB-DE001', 'DE', 'Common', 'NM', 1)`).run();
  return db;
}

test('I1: Handy-Verkauf kommt am PC an (Kanal, Verkauf, Position, Exemplar) und laesst sich am PC stornieren', () => {
  const db = dbWithLiveCopy();
  Sync._recentlyPushedSales.clear(); Sync._recentlyPushedItems.clear(); Sync._recentlyPushedChannels.clear();
  Sync._applyPulledChannels(db, [{ channel_id: 'ebay', name: 'eBay', fee_percent: 0, builtin: true, sort: 2, deleted: false,
    created_at: '1970-01-01T00:00:00+00:00', updated_at: '1970-01-01T00:00:00+00:00' }]);
  assert.equal(Sync._applyPulledSales(db, [SALE]), 1);
  assert.equal(Sync._applyPulledItems(db, [ITEM]), 1);
  Sync.applyRemoteCopy(db, { ...COPY, deleted: true, for_sale: false, sold_in: 's1' });
  assert.deepEqual({ ...db.prepare('SELECT deleted, sold_in FROM card_copies WHERE copy_id = ?').get('c1') }, { deleted: 1, sold_in: 's1' });

  const o = Sales.salesOverview(db, { period: 'gesamt', today: '2026-09-21' });
  assert.equal(o.totals.sales, 1);
  assert.equal(o.totals.cards, 1);
  assert.equal(o.totals.netCents, 840);
  assert.equal(o.totals.marketCents, 300);
  assert.equal(o.sales.length, 1);
  assert.equal(o.sales[0].cards, 1);
  assert.equal(o.sales[0].netCents, 840);
  assert.equal(o.sales[0].marketCents, 300);

  Sales.cancelSale(db, 's1');
  assert.deepEqual({ ...db.prepare('SELECT deleted, sold_in, for_sale FROM card_copies WHERE copy_id = ?').get('c1') },
    { deleted: 0, sold_in: null, for_sale: 1 });
});

function dbWithoutSoldIn() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  return db;
}
const pullPointer = (db) => db.prepare("SELECT value FROM settings WHERE key = 'sync_copies_last_pull'").get()?.value ?? null;

test('I1: frisch angelegte sold_in-Spalte setzt den Exemplar-Pull-Zeiger zurueck, eine vorhandene nicht', () => {
  const db = dbWithoutSoldIn();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_copies_last_pull', '2026-09-20T00:00:00Z')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_copies_last_push', '2026-09-20T00:00:00Z')").run();
  ensureSalesSchema(db);
  assert.equal(pullPointer(db), null, 'Zeiger geloescht, naechster Abgleich zieht alle Exemplare neu');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sync_copies_last_push'").get().value, '2026-09-20T00:00:00Z', 'Push-Zeiger bleibt');

  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_copies_last_pull', '2026-09-21T00:00:00Z')").run();
  ensureSalesSchema(db);
  assert.equal(pullPointer(db), '2026-09-21T00:00:00Z', 'Spalte existiert schon -> Zeiger bleibt');
});

test('I1: ohne settings-Tabelle legt ensureSalesSchema die Spalte trotzdem an', () => {
  const db = dbWithoutSoldIn();
  db.exec('DROP TABLE settings');
  ensureSalesSchema(db);
  assert.ok(db.prepare('PRAGMA table_info(card_copies)').all().some((c) => c.name === 'sold_in'));
});

// ---- Abschluss-Fixwelle I3c: lokaler, noch nicht geschobener Verkauf gewinnt gegen einen alten Cloud-Stand ----
function dbWithLocalSale(pushCursor) {
  const db = dbWithLiveCopy();
  if (pushCursor) db.prepare("INSERT INTO settings (key, value) VALUES ('sync_copies_last_push', ?)").run(pushCursor);
  db.prepare("UPDATE card_copies SET deleted = 1, sold_in = 's1', for_sale = 0, updated_at = '2026-09-21 10:00:00' WHERE copy_id = 'c1'").run();
  return db;
}
const localCopy = (db) => ({ ...db.prepare('SELECT deleted, sold_in FROM card_copies WHERE copy_id = ?').get('c1') });

test('I3c: ungeschobener lokaler Verkauf wird nicht von einer Cloud-Zeile ohne sold_in ueberschrieben', () => {
  const db = dbWithLocalSale('2026-09-21T09:00:00Z');
  Sync.applyRemoteCopy(db, { ...COPY, condition: 'EX' });
  assert.deepEqual(localCopy(db), { deleted: 1, sold_in: 's1' });
  assert.equal(db.prepare("SELECT condition FROM card_copies WHERE copy_id = 'c1'").get().condition, 'NM');
  const noCursor = dbWithLocalSale(null);
  Sync.applyRemoteCopy(noCursor, COPY);
  assert.deepEqual(localCopy(noCursor), { deleted: 1, sold_in: 's1' }, 'ohne Push-Zeiger gilt alles als ungeschoben');
});

test('I3c: ohne Schutzbedingung wird die Cloud-Zeile angewandt', () => {
  const pushed = dbWithLocalSale('2026-09-21T11:00:00Z');
  Sync.applyRemoteCopy(pushed, COPY);
  assert.deepEqual(localCopy(pushed), { deleted: 0, sold_in: null }, 'schon geschoben -> Cloud gewinnt');

  const withSoldIn = dbWithLocalSale('2026-09-21T09:00:00Z');
  Sync.applyRemoteCopy(withSoldIn, { ...COPY, deleted: true, sold_in: 's2' });
  assert.deepEqual(localCopy(withSoldIn), { deleted: 1, sold_in: 's2' }, 'Cloud-Zeile mit sold_in -> angewandt');

  const liveLocal = dbWithLiveCopy();
  liveLocal.prepare("INSERT INTO settings (key, value) VALUES ('sync_copies_last_push', '2026-09-21T09:00:00Z')").run();
  Sync.applyRemoteCopy(liveLocal, { ...COPY, condition: 'EX' });
  assert.equal(liveLocal.prepare("SELECT condition FROM card_copies WHERE copy_id = 'c1'").get().condition, 'EX', 'lokal nicht verkauft -> angewandt');
});
