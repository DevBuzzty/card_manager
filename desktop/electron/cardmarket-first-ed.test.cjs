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

function printing(db, { id, set_code, rarity, name = 'Test Card', price = 10, locked = 0, pid = null, ts = null, language = 'DE' }, copies) {
  db.prepare(`INSERT INTO cards (id, name, set_code, language, rarity, price, price_locked, cm_product_id, cm_first_ed_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, set_code, language, rarity, price, locked, pid, ts);
  const P = { id, set_code, language, rarity };
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

test('Kandidaten (G4b): Sprachen ohne Cardmarket-Filter (KR, JP) sind keine Kandidaten', () => {
  const db = candidateDb();
  printing(db, { id: '9', set_code: 'RC04-KR001', rarity: 'Ultra Rare', language: 'KR' }, [{ edition: 'first' }]);
  printing(db, { id: '10', set_code: 'LOB-JP001', rarity: 'Ultra Rare', language: 'JP' }, [{ edition: 'first' }]);
  printing(db, { id: '11', set_code: 'LOB-EN001', rarity: 'Ultra Rare', language: 'EN' }, [{ edition: 'first' }]);
  assert.deepEqual(ids(firstEdCandidates(db, { minRank: 4, nowMs: NOW })), ['1', '11', '7']);
});

// --- Durchgang mit gestubbtem Fenster (Spec G4b: Angebotslisten N/Y statt Ab-Preis) ---
const { offersUrl } = require('./cardmarket-parse.cjs');
const VERSIONS = 'https://www.cardmarket.com/en/YuGiOh/Cards/Test-Card/Versions';
const PRODUCT = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare';
const PAGE_N = offersUrl(PRODUCT, false, 'DE');
const PAGE_Y = offersUrl(PRODUCT, true, 'DE');
const ROWS = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, imgSrc: '', href: '/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare' }];
const offer = (eur, condition = 'NM', lang = 'German') => ({ priceText: `${eur.toFixed(2).replace('.', ',')} €`, condition, labels: [lang] });
const table = (...eurs) => ({ found: true, rows: eurs.map((e) => offer(e)) });

function stub(pages, { challenge = [] } = {}) {
  const visited = [];
  return {
    visited,
    deps: {
      makeWindow: async () => ({ url: null, destroy() {} }),
      loadPage: async (win, url) => { visited.push(url); win.url = url; return !challenge.includes(url); },
      readRows: async (win) => (pages[win.url] && pages[win.url].rows) || [],
      readOffers: async (win) => (pages[win.url] && pages[win.url].offers) || { found: false, rows: [] },
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

test('Durchgang: Median der guenstigsten N/Y -> Faktor, Trigger setzt price_first_ed, keine price_history', async () => {
  const db = mamoDb();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PAGE_N]: { offers: table(20, 54, 55, 56, 57, 90) },   // Median der 5 guenstigsten = 55; Billig-Ausreisser 20 egal
    [PAGE_Y]: { offers: table(57, 58, 59, 300) },          // 4 Angebote -> Mittel aus 58 und 59 = 58,5
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N, PAGE_Y]);
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, skipped: out.skipped, errors: out.errors }, { updated: 1, noOffers: 0, skipped: 0, errors: 0 });
  const r = MAMO(db);
  assert.equal(r.f, 1.0636);
  assert.equal(r.pfe, 78.55);
  assert.ok(r.ts);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM price_history').get().n, 0);
});

test('Durchgang: weniger als 3 passende 1st-Ed-Angebote -> Faktor NULL, Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PAGE_N]: { offers: table(54, 55, 56) },
    [PAGE_Y]: { offers: { found: true, rows: [offer(500), offer(510), offer(1, 'PO'), offer(2, 'NM', 'English')] } },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(out.updated, 1);
  assert.equal(out.noOffers, 1);
  assert.deepEqual({ f: MAMO(db).f, pfe: MAMO(db).pfe }, { f: null, pfe: null });
  assert.ok(MAMO(db).ts);
});

test('Durchgang: Tabelle vorhanden, aber leer (seltener Druck) -> Faktor NULL + Zeitstempel, kein Fehler', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: { found: true, empty: true, rows: [] } }, [PAGE_Y]: { offers: { found: true, empty: true, rows: [] } } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, errors: out.errors }, { updated: 1, noOffers: 1, errors: 0 });
  assert.equal(MAMO(db).f, null);
  assert.ok(MAMO(db).ts);
});

test('Durchgang: Angebotstabelle fehlt (Markup geaendert) -> Faktor bleibt, nur Zeitstempel, errors++', async () => {
  for (const missing of ['N', 'Y']) {
    const db = mamoDb();
    db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
    const s = stub({
      [VERSIONS]: { rows: ROWS },
      [PAGE_N]: { offers: missing === 'N' ? { found: false, rows: [] } : table(54, 55, 56) },
      [PAGE_Y]: { offers: missing === 'Y' ? { found: false, rows: [] } : table(57, 58, 59) },
    });
    const out = await runFirstEdPass(db, { force: true, deps: s.deps });
    assert.deepEqual({ updated: out.updated, errors: out.errors }, { updated: 0, errors: 1 }, missing);
    const r = MAMO(db);
    assert.equal(r.f, 1.2, `${missing}: Faktor unveraendert`);
    assert.equal(r.pfe, 88.62);
    assert.ok(r.ts, `${missing}: Zeitstempel gesetzt, Kandidat blockiert den Poller nicht`);
  }
});

test('Durchgang: Verhaeltnis ueber 10 wird auf 10 gekappt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: table(1, 1, 1) }, [PAGE_Y]: { offers: table(50, 50, 50) } });
  await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(MAMO(db).f, 10);
  assert.equal(MAMO(db).pfe, 738.5);
});

test('Durchgang: Cloudflare-Pruefung auf Seite N -> nichts geschrieben, Y nicht geladen', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS } }, { challenge: [PAGE_N] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N]);
  assert.deepEqual({ updated: out.updated, skipped: out.skipped }, { updated: 0, skipped: 1 });
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: Cloudflare-Pruefung auf Seite Y -> nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: table(54, 55, 56) } }, { challenge: [PAGE_Y] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PAGE_N, PAGE_Y]);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: kein Produkt-Link oder keine Zeile -> nur Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: [{ ...ROWS[0], href: '' }] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS]);
  assert.equal(out.skipped, 1);
  const r = MAMO(db);
  assert.equal(r.f, null);
  assert.ok(r.ts);
});

test('Durchgang: englisches Printing filtert mit language=EN', async () => {
  const db = freshDb();
  printing(db, { id: 'e', set_code: 'MAMO-EN020', rarity: 'Ultra Rare', price: 50, language: 'EN' }, [{ edition: 'first' }]);
  const N = offersUrl(PRODUCT, false, 'EN'), Y = offersUrl(PRODUCT, true, 'EN');
  const en = (...eurs) => ({ found: true, rows: eurs.map((e) => offer(e, 'NM', 'English')) });
  const s = stub({ [VERSIONS]: { rows: ROWS }, [N]: { offers: en(40, 40, 40) }, [Y]: { offers: en(60, 60, 60) } });
  await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, N, Y]);
  assert.equal(db.prepare("SELECT cm_first_ed_factor AS f FROM cards WHERE id = 'e'").get().f, 1.5);
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
  const s = stub({ [VERSIONS]: { rows: ROWS } });
  let makeWindowCalls = 0;
  const deps = { ...s.deps, makeWindow: async () => { makeWindowCalls++; return { url: null, destroy() {} }; } };
  const out = await runFirstEdPass(db, { force: true, shouldAbort: () => true, deps });
  assert.equal(makeWindowCalls, 0);
  assert.deepEqual(s.visited, []);
  assert.equal(out.updated, 0);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang (Review G4b): teilweiser Markup-Bruch -> Faktor bleibt, nur Zeitstempel, errors++', async () => {
  const broken = [
    { found: true, empty: false, rows: [] },                                                            // .article-row umbenannt
    { found: true, empty: false, rows: [offer(54), offer(55), offer(56)].map((r) => ({ ...r, labels: [] })) }, // Sprach-Labels weg
  ];
  for (const bad of broken) {
    const db = mamoDb();
    db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
    const s = stub({ [VERSIONS]: { rows: ROWS }, [PAGE_N]: { offers: table(54, 55, 56) }, [PAGE_Y]: { offers: bad } });
    const out = await runFirstEdPass(db, { force: true, deps: s.deps });
    assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, errors: out.errors }, { updated: 0, noOffers: 0, errors: 1 });
    assert.equal(MAMO(db).f, 1.2, 'Faktor unveraendert');
    assert.ok(MAMO(db).ts);
  }
});
