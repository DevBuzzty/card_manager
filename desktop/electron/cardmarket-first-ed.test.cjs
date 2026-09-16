const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { addCopies } = require('./copies.cjs');
const { firstEdCandidates, runFirstEdPass } = require('./cardmarket-scraper.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 0, rarity TEXT DEFAULT 'Unknown', set_code TEXT,
             price REAL, language TEXT DEFAULT 'DE', price_locked INTEGER DEFAULT 0, cm_product_id INTEGER,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  return db;
}

function printing(db, { id, set_code, rarity, name = 'Test Card', price = 10, locked = 0, pid = null, ts = null }, copies) {
  db.prepare(`INSERT INTO cards (id, name, set_code, language, rarity, price, price_locked, cm_product_id, cm_first_ed_updated_at)
              VALUES (?, ?, ?, 'DE', ?, ?, ?, ?, ?)`).run(id, name, set_code, rarity, price, locked, pid, ts);
  const P = { id, set_code, language: 'DE', rarity };
  for (const c of copies) addCopies(db, P, { edition: c.edition, condition: 'NM', count: 1 });
  return P;
}

const NOW = Date.parse('2026-09-15T12:00:00Z');

function candidateDb() {
  const db = freshDb();
  printing(db, { id: '1', set_code: 'LOB-DE001', rarity: 'Ultra Rare' }, [{ edition: 'first' }]);
  printing(db, { id: '2', set_code: 'LOB-DE002', rarity: 'Ultra Rare' }, [{ edition: 'unknown' }]);
  printing(db, { id: '3', set_code: 'LOB-DE003', rarity: 'Ultra Rare' }, [{ edition: 'first' }, { edition: 'unknown' }]);
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE card_id = '3' AND edition = 'first'").run();
  printing(db, { id: '4', set_code: 'LOB-DE004', rarity: 'Ultra Rare', locked: 2 }, [{ edition: 'first' }]);
  printing(db, { id: '5', set_code: 'LOB-DE005', rarity: 'Common' }, [{ edition: 'first' }]);
  printing(db, { id: '6', set_code: 'LOB-DE006', rarity: 'Ultra Rare', ts: '2026-09-13 12:00:00' }, [{ edition: 'first' }]);
  printing(db, { id: '7', set_code: 'LOB-DE007', rarity: 'Secret Rare', pid: 904608, ts: '2026-09-05 12:00:00' }, [{ edition: 'first' }]);
  return db;
}
const ids = (list) => list.map((c) => c.id);

test('Kandidaten: Edition first, Schwelle, price_locked 2, 7-Tage-Frist, Bulk zählt, gelöschte Exemplare nicht, Reihenfolge', () => {
  const db = candidateDb();
  assert.deepEqual(ids(firstEdCandidates(db, { minRank: 4, nowMs: NOW })), ['1', '7']);
});

test('Kandidaten: force ignoriert die Frist', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 4, force: true, nowMs: NOW })), ['1', '7', '6']);
});

test('Kandidaten: Schwelle 1 nimmt Common mit, gleiche Zeit nach Schlüssel', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 1, nowMs: NOW })), ['1', '5', '7']);
});

test('Kandidaten: limit', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 1, nowMs: NOW, limit: 1 })), ['1']);
});

test('Kandidaten: set_code Unknown ist nie Kandidat', () => {
  const db = candidateDb();
  printing(db, { id: '8', set_code: 'Unknown', rarity: 'Unknown' }, [{ edition: 'first' }]);
  assert.deepEqual(ids(firstEdCandidates(db, { minRank: 1, nowMs: NOW })), ['1', '5', '7']);
});

// --- Durchgang mit gestubbtem Fenster ---
const VERSIONS = 'https://www.cardmarket.com/en/YuGiOh/Cards/Test-Card/Versions';
const PRODUCT = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare';
const FIRST = `${PRODUCT}?isFirstEd=Y`;
const ROWS = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, imgSrc: '', href: '/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare' }];

function stub(pages, { challenge = [] } = {}) {
  const visited = [];
  return {
    visited,
    deps: {
      makeWindow: async () => ({ url: null, destroy() {} }),
      loadPage: async (win, url) => { visited.push(url); win.url = url; return !challenge.includes(url); },
      readRows: async (win) => (pages[win.url] && pages[win.url].rows) || [],
      readInfoPairs: async (win) => (pages[win.url] && pages[win.url].pairs) || [],
      sleep: async () => {},
      setNameFor: async () => null,
      cardName: async (c) => c.name,
    },
  };
}
const MAMO = (db) => db.prepare("SELECT price_first_ed AS pfe, cm_first_ed_factor AS f, cm_first_ed_updated_at AS ts FROM cards WHERE id = 'm'").get();
const mamoDb = () => {
  const db = freshDb();
  printing(db, { id: 'm', set_code: 'MAMO-DE020', rarity: 'Ultra Rare', price: 73.85 }, [{ edition: 'first' }]);
  return db;
};

test('Durchgang: Treffer schreibt Faktor und Zeitstempel, Trigger setzt price_first_ed, keine price_history', async () => {
  const db = mamoDb();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PRODUCT]: { pairs: [{ label: 'From', value: '55,00 €' }, { label: 'Price Trend', value: '72,33 €' }] },
    [FIRST]: { pairs: [{ label: 'From', value: '58,00 €' }] },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT, FIRST]);
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, skipped: out.skipped, errors: out.errors }, { updated: 1, noOffers: 0, skipped: 0, errors: 0 });
  const r = MAMO(db);
  assert.equal(r.f, 1.0545);
  assert.equal(r.pfe, 77.87);
  assert.ok(r.ts, 'cm_first_ed_updated_at gesetzt');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM price_history').get().n, 0);
});

test('Durchgang: kein Angebot mit Filter -> Faktor NULL, price_first_ed NULL, Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
  assert.equal(MAMO(db).pfe, 88.62);
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PRODUCT]: { pairs: [{ label: 'From', value: '55,00 €' }] },
    [FIRST]: { pairs: [{ label: 'From', value: 'N/A' }] },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(out.updated, 1);
  assert.equal(out.noOffers, 1);
  const r = MAMO(db);
  assert.equal(r.f, null);
  assert.equal(r.pfe, null);
  assert.ok(r.ts);
});

test('Durchgang: Cloudflare-Pruefung auf der Produktseite -> nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS } }, { challenge: [PRODUCT] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT]);
  assert.equal(out.updated, 0);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: fromAll fehlt -> gefilterte Seite nicht geladen, nur Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PRODUCT]: { pairs: [] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT]);
  assert.equal(out.skipped, 1);
  const r = MAMO(db);
  assert.equal(r.pfe, null);
  assert.equal(r.f, null);
  assert.ok(r.ts, 'cm_first_ed_updated_at gesetzt, wie der Basis-Durchgang bei "kein Treffer"');
});

test('Durchgang: kein Produkt-Link oder keine Zeile -> nur Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: [{ ...ROWS[0], href: '' }] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS]);
  assert.equal(out.skipped, 1);
  const r = MAMO(db);
  assert.equal(r.pfe, null);
  assert.equal(r.f, null);
  assert.ok(r.ts, 'cm_first_ed_updated_at gesetzt, wie der Basis-Durchgang bei "kein Treffer"');
});

test('Durchgang: maxCards begrenzt die Kandidaten (Poller 2)', async () => {
  const db = freshDb();
  for (const id of ['a', 'b', 'c']) printing(db, { id, set_code: `MAMO-DE02${id === 'a' ? 0 : id === 'b' ? 1 : 2}`, rarity: 'Ultra Rare' }, [{ edition: 'first' }]);
  const s = stub({});
  const out = await runFirstEdPass(db, { force: true, maxCards: 2, deps: s.deps });
  assert.equal(out.candidates, 2);
  assert.equal(s.visited.length, 2, 'je Kandidat nur die Versions-Seite (ohne Zeilen)');
});

test('Durchgang: bereits abgebrochen vor der Schleife -> kein Fenster, nichts besucht, nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PRODUCT]: { pairs: [{ label: 'From', value: '55,00 €' }] }, [FIRST]: { pairs: [{ label: 'From', value: '58,00 €' }] } });
  let makeWindowCalls = 0;
  const deps = { ...s.deps, makeWindow: async () => { makeWindowCalls++; return { url: null, destroy() {} }; } };
  const out = await runFirstEdPass(db, { force: true, shouldAbort: () => true, deps });
  assert.equal(makeWindowCalls, 0, 'makeWindow wird bei bereits gesetztem Abbruch nicht gerufen');
  assert.deepEqual(s.visited, []);
  assert.equal(out.updated, 0);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});
