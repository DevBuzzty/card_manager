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
