const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { runCardmarketScrape, REST_MS } = require('./cardmarket-scraper.cjs');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const sqlTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 0, rarity TEXT DEFAULT 'Unknown', set_code TEXT,
             price REAL, language TEXT DEFAULT 'DE', price_locked INTEGER DEFAULT 0, cm_product_id INTEGER,
             cm_url TEXT, cm_updated_at DATETIME, cm_product_derived INTEGER DEFAULT 0, cm_lang_factor REAL,
             cm_estimate INTEGER DEFAULT 0, cm_estimate_max REAL, cm_challenge_at DATETIME,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  return db;
}

function add(db, { id, price = null, max = null, challenge = null, estimate = 0 }) {
  db.prepare(`INSERT INTO cards (id, name, set_code, language, rarity, quantity, price, cm_estimate, cm_estimate_max, cm_challenge_at)
              VALUES (?, ?, ?, 'DE', 'Ultra Rare', 1, ?, ?, ?, ?)`)
    .run(id, `Card ${id}`, `LOB-DE00${id}`, price, estimate, max, challenge);
}
const row = (db, id) => db.prepare('SELECT * FROM cards WHERE id = ?').get(id);

// Scheinfenster: loadPage/readRows/sleep/diag kommen ueber deps; die Diagnose-Datei bleibt so aus userData draussen.
async function run(db, { challenge = [], ...opts } = {}) {
  const visited = [];
  const deps = {
    makeWindow: async () => ({ destroy() {} }),
    loadPage: async (win, url, zaehler) => {
      visited.push(url); win.url = url;
      if (!challenge.includes(url)) return true;
      zaehler.gesehen++; zaehler.gescheitert++; // wie das echte loadPage
      return false;
    },
    readRows: async () => [{ expansion: 'Maze', code: 'LOB', rarity: 'Ultra Rare', trend: 7, imgSrc: '', href: '' }],
    sleep: async () => {},
    cardName: async (c) => c.name,
    setNameFor: async () => null,
    diag: () => {},
  };
  const res = await runCardmarketScrape(db, { nowMs: NOW, ...opts, deps });
  return { res, visited };
}
const url = (id) => `https://www.cardmarket.com/en/YuGiOh/Cards/Card-${id}/Versions`;

test('Basis: nur Drucke ab 5 € (max der Spanne zählt)', async () => {
  const db = freshDb();
  add(db, { id: 'A', price: 1, max: 8 });
  add(db, { id: 'B', price: 4 });
  add(db, { id: 'C', price: 6 });
  const { visited } = await run(db);
  assert.deepEqual(visited.sort(), [url('A'), url('C')]);
});

test('Basis: ohne Preis kein Kandidat', async () => {
  const db = freshDb();
  add(db, { id: 'A', price: null });
  const { visited } = await run(db);
  assert.deepEqual(visited, []);
});

test('Basis: gescheiterte Prüfung stempelt cm_challenge_at, bricht ab', async () => {
  const db = freshDb();
  add(db, { id: 'A', price: 6 });
  add(db, { id: 'B', price: 7 });
  const { res, visited } = await run(db, { challenge: [url('A'), url('B')] });
  assert.equal(visited.length, 1);
  assert.equal(res.abgebrochen, true);
  assert.equal(res.pruefungenGescheitert, 1);
  const stamped = [row(db, 'A'), row(db, 'B')].filter((r) => r.cm_challenge_at);
  assert.equal(stamped.length, 1);
  assert.equal(stamped[0].cm_updated_at, null);
});

test('Basis: Ruhe 3 Tage', async () => {
  assert.equal(REST_MS, 3 * DAY);
  const db = freshDb();
  add(db, { id: 'A', price: 6, challenge: sqlTs(NOW - 2 * DAY) });
  add(db, { id: 'B', price: 6, challenge: sqlTs(NOW - 4 * DAY) });
  const { visited } = await run(db);
  assert.deepEqual(visited, [url('B')]);
});

test('Basis: Erfolg setzt cm_estimate zurück und löscht cm_challenge_at', async () => {
  const db = freshDb();
  add(db, { id: 'A', price: 6, max: 9, estimate: 1, challenge: sqlTs(NOW - 4 * DAY) });
  const { res } = await run(db);
  const r = row(db, 'A');
  assert.equal(res.updated, 1);
  assert.equal(r.cm_estimate, 0);
  assert.equal(r.cm_estimate_max, null);
  assert.equal(r.cm_challenge_at, null);
  assert.equal(r.price_locked, 1);
  assert.equal(r.price, 7);
});

test('loadPage: sich selbst lösende Prüfung zählt gesehen, nicht gescheitert', async () => {
  const { loadPage } = require('./cardmarket-scraper.cjs');
  let n = 0;
  const win = {
    loadURL: async () => {},
    webContents: { getTitle: () => (n++ < 2 ? 'Just a moment...' : 'Cards'), executeJavaScript: async () => '<html></html>' },
  };
  const zaehler = { gesehen: 0, gescheitert: 0 };
  assert.equal(await loadPage(win, 'x', zaehler), true);
  assert.deepEqual(zaehler, { gesehen: 1, gescheitert: 0 });
});
