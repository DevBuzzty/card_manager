const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureEbaySchema, EBAY_SOLD_COLS } = require('./ebay-schema.cjs');
const { soldRowFor, insightsAccess } = require('./ebay-sold.cjs');
const sync = require('./sync.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  ensureEbaySchema(db);
  return db;
}
function fakeClient(pages) {
  const calls = []; const q = {};
  for (const m of ['select', 'gt', 'order', 'eq']) q[m] = (...a) => { calls.push(m); return q; };
  q.range = () => Promise.resolve({ data: pages.shift() ?? [], error: null });
  q.maybeSingle = () => Promise.resolve({ data: pages.shift() ?? null, error: null });
  return { calls, from: (t) => { calls.push(`from:${t}`); return q; } };
}
const P = { card_id: '74677422', set_code: 'SDJ-G001', language: 'DE', rarity: 'Ultra Rare' };
const CLOUD = { ...P, median_all: '7.5', n_all: 12, median_first: null, n_first: 0, last_sold_at: '2026-09-28T14:03:00+00:00', last_sold_price: '6',
  sales: [{ title: 'SDJ-G001', price: 6, sold_at: '2026-09-28T14:03:00Z', url: 'https://www.ebay.de/itm/1', first: false }],
  status: 'ok', checked_at: '2026-10-05T04:30:00+00:00', updated_at: '2026-10-05T04:30:01+00:00' };

test('ebay_sold_prices ist ein Nur-Lese-Strom (nie gepusht)', () => {
  assert.ok(sync._READ_ONLY_TABLES.includes('ebay_sold_prices'));
  assert.ok(!sync._PUSHED_TABLES.includes('ebay_sold_prices'));
  assert.deepEqual(EBAY_SOLD_COLS.slice(0, 4), ['card_id', 'set_code', 'language', 'rarity']);
});

test('Pull: Zahlen als Number, sales als JSON-Text; soldRowFor liefert geparst; Cursor gesetzt', async () => {
  const db = freshDb();
  assert.equal(await sync._pullReadOnlyTable(fakeClient([[CLOUD]]), db, 'ebay_sold_prices'), 1);
  const r = soldRowFor(db, P);
  assert.equal(r.median_all, 7.5);
  assert.equal(r.last_sold_price, 6);
  assert.deepEqual(r.sales, CLOUD.sales);
  assert.equal(soldRowFor(db, { ...P, rarity: 'Common' }), null);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sync_ebay_sold_last_pull'").get().value, CLOUD.updated_at);
});

test('soldRowFor: kaputtes sales-JSON -> leere Liste statt Absturz', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO ebay_sold_prices (card_id, set_code, language, rarity, n_all, n_first, sales, status, checked_at, updated_at)
              VALUES (?, ?, ?, ?, 0, 0, '{kaputt', 'zu_wenig', 'x', 'x')`).run(P.card_id, P.set_code, P.language, P.rarity);
  assert.deepEqual(soldRowFor(db, P).sales, []);
});

test('Zugangsstatus: Pull speichert, insightsAccess liest; ohne Stand unbekannt', async () => {
  const db = freshDb();
  assert.equal(insightsAccess(db), 'unbekannt');
  assert.equal(await sync._pullInsightsState(fakeClient([{ access: 'fehlt', last_error: null, last_run_at: '2026-10-05T04:30:00+00:00' }]), db), true);
  assert.equal(insightsAccess(db), 'fehlt');
  assert.equal(await sync._pullInsightsState(fakeClient([{ access: 'fehlt', last_error: null, last_run_at: '2026-10-05T04:30:00+00:00' }]), db), false);
});

test('Fehlende Cloud-Tabelle: Pull wirft (Aufrufer protokolliert), lokale Abfrage bleibt null', async () => {
  const db = freshDb();
  const c = { from: () => ({ select() { return this; }, gt() { return this; }, order() { return this; },
    range: () => Promise.resolve({ data: null, error: { message: 'relation "public.ebay_sold_prices" does not exist' } }) }) };
  await assert.rejects(() => sync._pullReadOnlyTable(c, db, 'ebay_sold_prices'), /ebay_sold_prices/);
  assert.equal(soldRowFor(db, P), null);
});
