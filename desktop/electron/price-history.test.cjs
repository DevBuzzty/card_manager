const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { recordPrice, lastRecorded } = require('./price-history.cjs');

const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d); return d;
}

test('records only changes, one row per day (last wins), ignores non-positive', () => {
  const d = db();
  assert.equal(lastRecorded(d, P), null);
  assert.equal(recordPrice(d, P, 0, 'ygoprodeck'), false);
  assert.equal(recordPrice(d, P, 1.5, 'ygoprodeck'), true);
  assert.equal(recordPrice(d, P, 1.5, 'cm_bulk'), false, 'same price -> no write');
  assert.equal(recordPrice(d, P, 2.0, 'cm_bulk'), true);
  const rows = d.prepare('SELECT price, source, variant FROM price_history').all();
  assert.deepStrictEqual(rows, [{ price: 2.0, source: 'cm_bulk', variant: 'base' }], 'same day -> upsert, not a second row');
  assert.equal(lastRecorded(d, P), 2.0);
  assert.equal(recordPrice(d, P, 3.0, 'cm_scrape', 'first'), true, 'variants are independent series');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM price_history').get().n, 2);
});

const { seedPriceHistory } = require('./price-history.cjs');

function seedDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, price_locked INTEGER DEFAULT 0, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  const card = d.prepare('INSERT INTO cards (id,set_code,language,rarity,price,price_locked,quantity,deleted) VALUES (?,?,?,?,?,?,0,0)');
  card.run('1', 'A-DE001', 'DE', 'Rare', 5, 1);     // CM, lebend, ohne Zeile -> cm_bulk
  card.run('2', 'A-DE002', 'DE', 'Rare', 3, 0);     // YGO, lebend, ohne Zeile -> ygoprodeck
  card.run('3', 'A-DE003', 'DE', 'Rare', 4, 2);     // manuell -> manual
  card.run('4', 'A-DE004', 'DE', 'Rare', 7, 1);     // hat schon eine Zeile -> unberuehrt
  card.run('5', 'A-DE005', 'DE', 'Rare', null, 1);  // ohne Preis -> keine
  card.run('6', 'A-DE006', 'DE', 'Rare', 9, 1);     // ohne lebendes Exemplar -> keine
  const cp = d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,deleted) VALUES (?,?,?,?,?,?)`);
  ['1', '2', '3', '4', '5'].forEach((id) => cp.run(`c${id}`, id, `A-DE00${id}`, 'DE', 'Rare', 0));
  cp.run('c6', '6', 'A-DE006', 'DE', 'Rare', 1);
  d.prepare(`INSERT INTO price_history (card_id,set_code,language,rarity,variant,day,price,source) VALUES ('4','A-DE004','DE','Rare','base','2026-09-01',6,'cm_bulk')`).run();
  return d;
}

test('seedPriceHistory: Startzeile nur fuer lebende Printings mit Preis und ohne base-Zeile, Quelle aus price_locked', () => {
  const d = seedDb();
  const r = seedPriceHistory(d, '2026-09-14');
  assert.deepStrictEqual(r, { inserted: 3, skipped: false });
  const rows = d.prepare(`SELECT card_id, day, price, source, variant FROM price_history ORDER BY card_id`).all();
  assert.deepStrictEqual(rows, [
    { card_id: '1', day: '2026-09-14', price: 5, source: 'cm_bulk', variant: 'base' },
    { card_id: '2', day: '2026-09-14', price: 3, source: 'ygoprodeck', variant: 'base' },
    { card_id: '3', day: '2026-09-14', price: 4, source: 'manual', variant: 'base' },
    { card_id: '4', day: '2026-09-01', price: 6, source: 'cm_bulk', variant: 'base' },
  ]);
});

test('seedPriceHistory: laeuft nur einmal (Setting price_history_seeded)', () => {
  const d = seedDb();
  seedPriceHistory(d, '2026-09-14');
  d.prepare(`UPDATE cards SET price = 8 WHERE id = '6'`).run();
  d.prepare(`UPDATE card_copies SET deleted = 0 WHERE copy_id = 'c6'`).run();
  assert.deepStrictEqual(seedPriceHistory(d, '2026-09-15'), { inserted: 0, skipped: true });
});

test('seedPriceHistory: ohne Setting, aber mit vorhandenen Zeilen idempotent', () => {
  const d = seedDb();
  seedPriceHistory(d, '2026-09-14');
  d.prepare(`DELETE FROM settings WHERE key = 'price_history_seeded'`).run();
  assert.deepStrictEqual(seedPriceHistory(d, '2026-09-14'), { inserted: 0, skipped: false });
});

const { mergeRemotePriceHistory } = require('./price-history.cjs');

function mergeDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  return d;
}

test('mergeRemotePriceHistory: fuegt neue Cloud-Zeile ein, recorded_at umgewandelt', () => {
  const d = mergeDb();
  const n = mergeRemotePriceHistory(d, [
    { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', variant: 'base', day: '2026-09-14', price: 5, source: 'cloud', recorded_at: '2026-09-14T05:00:01.123+00:00' },
  ]);
  assert.equal(n, 1);
  const row = d.prepare('SELECT price, source, recorded_at FROM price_history').get();
  assert.deepStrictEqual(row, { price: 5, source: 'cloud', recorded_at: '2026-09-14 05:00:01' });
});

test('mergeRemotePriceHistory: vorhandene lokale Zeile gleichen Schluessels bleibt unveraendert', () => {
  const d = mergeDb();
  d.prepare(`INSERT INTO price_history (card_id,set_code,language,rarity,variant,day,price,source,recorded_at) VALUES ('1','LOB-DE001','DE','Ultra Rare','base','2026-09-14',3,'ygoprodeck','2026-09-14 04:00:00')`).run();
  const n = mergeRemotePriceHistory(d, [
    { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', variant: 'base', day: '2026-09-14', price: 5, source: 'cloud', recorded_at: '2026-09-14T05:00:01.123+00:00' },
  ]);
  assert.equal(n, 0);
  const row = d.prepare('SELECT price, source FROM price_history').get();
  assert.deepStrictEqual(row, { price: 3, source: 'ygoprodeck' });
});

test('mergeRemotePriceHistory: price <= 0 und fehlendes day werden uebersprungen', () => {
  const d = mergeDb();
  const n = mergeRemotePriceHistory(d, [
    { card_id: '1', set_code: 'A', language: 'DE', rarity: 'Rare', variant: 'base', day: '2026-09-14', price: 0, source: 'cloud', recorded_at: '2026-09-14T05:00:01Z' },
    { card_id: '2', set_code: 'A', language: 'DE', rarity: 'Rare', variant: 'base', day: null, price: 5, source: 'cloud', recorded_at: '2026-09-14T05:00:01Z' },
  ]);
  assert.equal(n, 0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM price_history').get().n, 0);
});

test('mergeRemotePriceHistory: leere Raritaet landet unter Unknown', () => {
  const d = mergeDb();
  mergeRemotePriceHistory(d, [
    { card_id: '1', set_code: 'A', language: 'DE', rarity: '', variant: 'base', day: '2026-09-14', price: 5, source: 'cloud', recorded_at: '2026-09-14T05:00:01Z' },
  ]);
  const row = d.prepare('SELECT rarity FROM price_history').get();
  assert.deepStrictEqual(row, { rarity: 'Unknown' });
});

// F3 (Minor 1) — Startzeile normalisiert den Schluessel wie recordPrice/norm.
function seedEdgeDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, price_locked INTEGER DEFAULT 0, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  // Karte 7: Raritaet '' (leer). Karte 8: Raritaet NULL. Beide card_copies bereits mit 'Unknown',
  // so wie es add-card-to-db/die Migration tatsaechlich schreiben (card_copies.rarity ist NOT NULL).
  d.prepare('INSERT INTO cards (id,set_code,language,rarity,price,price_locked,quantity,deleted) VALUES (?,?,?,?,?,?,0,0)').run('7', 'B-DE007', 'DE', '', 4, 0);
  d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,deleted) VALUES ('c7','7','B-DE007','DE','Unknown',0)`).run();
  d.prepare('INSERT INTO cards (id,set_code,language,rarity,price,price_locked,quantity,deleted) VALUES (?,?,?,?,?,?,0,0)').run('8', 'B-DE008', 'DE', null, 6, 0);
  d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,deleted) VALUES ('c8','8','B-DE008','DE','Unknown',0)`).run();
  return d;
}

test('seedPriceHistory: leere/NULL Raritaet bekommt eine Startzeile unter Unknown', () => {
  const d = seedEdgeDb();
  const r = seedPriceHistory(d, '2026-09-14');
  assert.deepStrictEqual(r, { inserted: 2, skipped: false });
  const rows = d.prepare(`SELECT card_id, rarity FROM price_history ORDER BY card_id`).all();
  assert.deepStrictEqual(rows, [
    { card_id: '7', rarity: 'Unknown' },
    { card_id: '8', rarity: 'Unknown' },
  ]);
});

test('seedPriceHistory: anschliessendes recordPrice (rarity "") schreibt unter denselben Schluessel, keine zweite Zeile', () => {
  const d = seedEdgeDb();
  seedPriceHistory(d, '2026-09-14');
  assert.equal(recordPrice(d, { id: '7', set_code: 'B-DE007', language: 'DE', rarity: '' }, 4, 'ygoprodeck'), false,
    'gleicher Preis unter demselben normalisierten Schluessel -> kein weiterer Schreibvorgang');
  assert.equal(d.prepare(`SELECT COUNT(*) n FROM price_history WHERE card_id = '7'`).get().n, 1, 'keine zweite Zeile fuer denselben Tag/Schluessel');
});
