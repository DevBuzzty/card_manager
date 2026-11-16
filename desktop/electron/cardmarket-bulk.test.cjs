// desktop/electron/cardmarket-bulk.test.cjs — runBulkRefresh against an in-memory DB with injected
// file data (no network, no disk). Run with ELECTRON_RUN_AS_NODE=1 (better-sqlite3 ABI).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { runBulkRefresh, getBulkStatus } = require('./cardmarket-bulk.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSealedSchema, addSealed } = require('./sealed-items.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cards (id TEXT, name TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT,
      quantity INTEGER DEFAULT 1, price REAL, price_locked INTEGER DEFAULT 0, cm_url TEXT,
      cm_updated_at DATETIME, cm_product_id INTEGER, cm_product_derived INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
      updated_at DATETIME, cm_estimate INTEGER DEFAULT 0, cm_estimate_max REAL, cm_estimate_at DATETIME, cm_challenge_at DATETIME, cm_first_ed_challenge_at DATETIME,
      PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL);
  `);
  ensureCopiesSchema(db); // recordPrice (wired into applyPrices) needs price_history
  ensureSealedSchema(db); // Spec G3 Schritt C liest sealed_items
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run('46986414', 'Dark Magician', 'MRD-DE001', 'Common', 0.5, null);       // unambiguous in files -> resolves to 102801
  ins.run('46986414', 'Dark Magician', 'LOB-DE005', 'Ultra Rare', 9.0, null);   // 4 products in LOB -> stays NULL
  ins.run('00102380', 'Lava Golem', 'RA01-DE001', 'Secret Rare', 3.0, 741145);  // already resolved -> priced from guide
  ins.run('12345678', 'Ghost Card', 'XXX-DE001', 'Common', 1.0, 999999);        // resolved but not in guide -> skipped
  return db;
}

const files = {
  cardsets: [
    { set_name: 'Metal Raiders', set_code: 'MRD' },
    { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB' },
    { set_name: 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)', set_code: 'LOB' },
    { set_name: '25th Anniversary Rarity Collection', set_code: 'RA01' },
  ],
  nonsingles: [
    { name: 'Metal Raiders Booster', idExpansion: 1077 },
    { name: 'Legend of Blue Eyes White Dragon Booster', idExpansion: 1064 },
    { name: '25th Anniversary Rarity Collection Booster', idExpansion: 5404 },
  ],
  singles: [
    { idProduct: 102800, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 577923, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 578096, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 578097, name: 'Dark Magician', idExpansion: 1064 },
    { idProduct: 102801, name: 'Dark Magician', idExpansion: 1077 },
    { idProduct: 741145, name: 'Lava Golem', idExpansion: 5404 },
  ],
  guide: [
    { idProduct: 102801, trend: 0.42, low: 0.1 },
    { idProduct: 741145, trend: 12.5, low: 9.0 },
    { idProduct: 102800, trend: null, low: 20 },
  ],
};

test('runBulkRefresh resolves unambiguous printings, prices resolved ones with trend, skips the rest', async () => {
  const db = makeDb();
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.error, undefined);
  assert.equal(res.resolved, 1);
  assert.equal(res.reasons.ambiguous, 1);
  assert.equal(res.priced, 2);      // 102801 (just resolved) + 741145
  assert.equal(res.skipped, 1);     // 999999 not in guide
  assert.equal(res.unresolved, 1);  // LOB Dark Magician

  const mrd = db.prepare("SELECT price, price_locked, cm_product_id, cm_updated_at FROM cards WHERE set_code = 'MRD-DE001'").get();
  assert.equal(mrd.cm_product_id, 102801);
  assert.equal(mrd.price, 0.42);
  assert.equal(mrd.price_locked, 1);
  assert.ok(mrd.cm_updated_at);

  const lob = db.prepare("SELECT price, cm_product_id FROM cards WHERE set_code = 'LOB-DE005'").get();
  assert.equal(lob.cm_product_id, null);
  assert.equal(lob.price, 9.0); // untouched

  const ra = db.prepare("SELECT price FROM cards WHERE set_code = 'RA01-DE001'").get();
  assert.equal(ra.price, 12.5);

  const ghost = db.prepare("SELECT price FROM cards WHERE set_code = 'XXX-DE001'").get();
  assert.equal(ghost.price, 1.0); // not in guide -> unchanged

  const st = getBulkStatus(db);
  assert.ok(st.lastRun);
  assert.equal(st.resolvedCount, 3);
  assert.equal(st.unresolvedCount, 1);
});

test('runBulkRefresh with a null trend leaves the price unchanged', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET cm_product_id = 102800 WHERE set_code = 'LOB-DE005'").run();
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(db.prepare("SELECT price FROM cards WHERE set_code = 'LOB-DE005'").get().price, 9.0);
  assert.equal(res.skipped, 2); // 102800 (null trend) + 999999
});

test('runBulkRefresh reports a download error and writes no last-run stamp', async () => {
  const db = makeDb();
  const res = await runBulkRefresh(db, { userDataPath: null, files: { error: new Error('boom') } });
  assert.equal(res.error, 'download');
  assert.equal(res.priced, 0);
  assert.equal(getBulkStatus(db).lastRun, null);
});

test('applyPrices does not overwrite a manually-locked price (price_locked = 2)', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET price_locked = 2 WHERE set_code = 'RA01-DE001'").run();
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  const ra = db.prepare("SELECT price, price_locked FROM cards WHERE set_code = 'RA01-DE001'").get();
  assert.equal(ra.price, 3.0);       // untouched despite guide trend 12.5 for its idProduct
  assert.equal(ra.price_locked, 2);
  assert.equal(res.priced, 1);       // only MRD (newly resolved); RA01 locked out, ghost not in guide
});

test('applyPrices treats guide trend: 0 as no-trend (price unchanged, counted skipped)', async () => {
  const db = makeDb();
  const filesZeroTrend = { ...files, guide: files.guide.map(g => g.idProduct === 741145 ? { ...g, trend: 0 } : g) };
  const res = await runBulkRefresh(db, { userDataPath: null, files: filesZeroTrend });
  const ra = db.prepare("SELECT price FROM cards WHERE set_code = 'RA01-DE001'").get();
  assert.equal(ra.price, 3.0);  // trend 0 is not a real price -> not applied
  assert.equal(res.skipped, 2); // RA01 (trend 0) + ghost (not in guide)
});

test('running runBulkRefresh twice with unchanged data prices nothing on the second run', async () => {
  const db = makeDb();
  await runBulkRefresh(db, { userDataPath: null, files });
  const res2 = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res2.priced, 0);
  assert.equal(res2.unchanged, 2); // MRD + RA01 already carry the same guide price
});

test('countUnresolved / getBulkStatus exclude set_code = Unknown rows', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run('11112222', 'Mystery Card', 'Unknown', 'Common', 0, null);
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.unresolved, 1); // still just the ambiguous LOB Dark Magician
  assert.equal(getBulkStatus(db).unresolvedCount, 1);
});

test('Schritt C: runBulkRefresh setzt Sealed-Preise aus demselben Price-Guide, nur bei Aenderung', async () => {
  const db = makeDb();
  // cm_product_id 741145 steht im Test-Guide oben mit trend 12.5.
  addSealed(db, { cm_product_id: 741145, name: 'Testdisplay', kind: 'display', trend: 10 }, 2);
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.sealedPriced, 1);
  assert.equal(db.prepare('SELECT price FROM sealed_items').get().price, 12.5);
  const res2 = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res2.sealedPriced, 0);
  const failed = await runBulkRefresh(db, { userDataPath: null, files: { error: new Error('boom') } });
  assert.equal(failed.sealedPriced, 0);
});

test('Schritt C: wirft applySealedPrices, laufen A/B trotzdem durch und cm_bulk_last_run wird gestempelt', async () => {
  const db = makeDb();
  db.exec('DROP TABLE sealed_items'); // laesst applySealedPrices scheitern (no such table)
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.resolved, 1);
  assert.equal(res.priced, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.unchanged, 0);
  assert.equal(res.unresolved, 1);
  assert.equal(typeof res.sealed?.error, 'string');
  assert.ok(res.sealed.error.length > 0);
  assert.ok(getBulkStatus(db).lastRun, 'cm_bulk_last_run wird trotz gescheitertem Sealed-Schritt gestempelt');
});

test('applyPrices: KR-Zeilen laesst der Cardmarket-Lauf aus (Preis kommt aus kr-prices.cjs)', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO cards (id, name, set_code, language, rarity, price, cm_product_id, cm_lang_factor) VALUES ('00102380','Lava Golem','RA01-KR001','KR','Secret Rare',3.5,741145,0.5)").run();
  await runBulkRefresh(db, { files });
  const kr = db.prepare("SELECT price FROM cards WHERE set_code='RA01-KR001'").get();
  const de = db.prepare("SELECT price FROM cards WHERE set_code='RA01-DE001'").get();
  assert.strictEqual(kr.price, 3.5);
  assert.strictEqual(de.price, 12.5);
});

test('runBulkRefresh leitet mehrdeutige Drucke aus zwei Vorbildern des Sets ab und markiert sie', async () => {
  const db = makeDb();
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run('89631139', 'Blue-Eyes White Dragon', 'LOB-DE001', 'Ultra Rare', 5, 600002); // echte IDs, je 3. Version
  ins.run('74677422', 'Red-Eyes Black Dragon', 'LOB-DE070', 'Ultra Rare', 5, 600012);
  const lobVersions = (base, name) => [0, 1, 2, 3].map(k => ({ idProduct: base + k, name, idExpansion: 1064 }));
  const f = { ...files,
    singles: [...files.singles, ...lobVersions(600000, 'Blue-Eyes White Dragon'), ...lobVersions(600010, 'Red-Eyes Black Dragon')],
    guide: [...files.guide, { idProduct: 578096, trend: 7.77 }] };
  const res = await runBulkRefresh(db, { userDataPath: null, files: f, raritiesOf: async () => ['Common', 'Rare', 'Super Rare', 'Ultra Rare'] });
  assert.equal(res.derived, 1);
  const lob = db.prepare("SELECT price, cm_product_id, cm_product_derived FROM cards WHERE set_code = 'LOB-DE005'").get();
  assert.deepEqual(lob, { price: 7.77, cm_product_id: 578096, cm_product_derived: 1 }); // 3. Version von Dark Magician
  assert.equal(db.prepare("SELECT cm_product_derived FROM cards WHERE set_code = 'MRD-DE001'").get().cm_product_derived, 0);
});

test('abgeleitete IDs zaehlen nicht als Vorbild', async () => {
  const db = makeDb();
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id, cm_product_derived) VALUES (?, ?, ?, ?, ?, ?, ?)");
  ins.run('89631139', 'Blue-Eyes White Dragon', 'LOB-DE001', 'Ultra Rare', 5, 600003, 1);
  ins.run('74677422', 'Red-Eyes Black Dragon', 'LOB-DE070', 'Ultra Rare', 5, 600013, 1);
  const lobVersions = (base, name) => [0, 1, 2, 3].map(k => ({ idProduct: base + k, name, idExpansion: 1064 }));
  const f = { ...files, singles: [...files.singles, ...lobVersions(600000, 'Blue-Eyes White Dragon'), ...lobVersions(600010, 'Red-Eyes Black Dragon')] };
  const res = await runBulkRefresh(db, { userDataPath: null, files: f, raritiesOf: async () => ['Common', 'Rare', 'Super Rare', 'Ultra Rare'] });
  assert.equal(res.derived, 0);
  assert.equal(db.prepare("SELECT cm_product_id FROM cards WHERE set_code = 'LOB-DE005'").get().cm_product_id, null);
});

test('Deck-Set (eine Seltenheit mehrfach) wird nicht abgeleitet', async () => {
  const db = makeDb();
  const ins = db.prepare("INSERT INTO cards (id, name, set_code, rarity, price, cm_product_id) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run('89631139', 'Blue-Eyes White Dragon', 'LOB-DE001', 'Ultra Rare', 5, 600002);
  ins.run('74677422', 'Red-Eyes Black Dragon', 'LOB-DE070', 'Ultra Rare', 5, 600012);
  const lobVersions = (base, name) => [0, 1, 2, 3].map(k => ({ idProduct: base + k, name, idExpansion: 1064 }));
  const f = { ...files, singles: [...files.singles, ...lobVersions(600000, 'Blue-Eyes White Dragon'), ...lobVersions(600010, 'Red-Eyes Black Dragon')] };
  const res = await runBulkRefresh(db, { userDataPath: null, files: f, raritiesOf: async () => ['Ultra Rare', 'Ultra Rare', 'Common', 'Rare'] });
  assert.equal(res.derived, 0);
});

// --- Schaetzpreis (Spec 2026-11-16 §1): mehrdeutige Drucke bekommen den niedrigsten Trend der Kandidaten ---
const estGuide = [
  { idProduct: 102800, trend: 2.0 }, { idProduct: 577923, trend: 3.5 },
  { idProduct: 578096, trend: 40.0 }, { idProduct: 578097, trend: 0 },
  { idProduct: 102801, trend: 0.42 }, { idProduct: 741145, trend: 12.5 },
];
const estFiles = { ...files, guide: estGuide };
const LOB = "SELECT price, price_locked, cm_estimate, cm_estimate_max, cm_estimate_at, cm_updated_at, cm_product_id FROM cards WHERE set_code = 'LOB-DE005'";

test('Schaetzung: mehrdeutiger Druck bekommt min-Trend, max, Markierung', async () => {
  const db = makeDb();
  const res = await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const lob = db.prepare(LOB).get();
  assert.equal(lob.price, 2.0);
  assert.equal(lob.cm_estimate, 1);
  assert.equal(lob.cm_estimate_max, 40.0);
  assert.equal(lob.price_locked, 1);
  assert.ok(lob.cm_estimate_at);
  assert.equal(lob.cm_updated_at, null);
  assert.equal(lob.cm_product_id, null);
  assert.equal(res.estimated, 1);
});

test('Schaetzung: Sprachfaktor wird angewendet', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET cm_lang_factor = 0.5 WHERE set_code = 'LOB-DE005'").run();
  await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const lob = db.prepare(LOB).get();
  assert.equal(lob.price, 1.0);
  assert.equal(lob.cm_estimate_max, 20.0);
});

test('Schaetzung: Scrape-Preis ohne ID bleibt', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET cm_url = 'https://www.cardmarket.com/x' WHERE set_code = 'LOB-DE005'").run();
  await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const lob = db.prepare(LOB).get();
  assert.equal(lob.price, 9.0);
  assert.equal(lob.cm_estimate, 0);
});

test('Schaetzung: price_locked 2 und KR bleiben unberuehrt', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET price_locked = 2 WHERE set_code = 'LOB-DE005'").run();
  db.prepare("INSERT INTO cards (id, name, set_code, language, rarity, price) VALUES ('46986414', 'Dark Magician', 'LOB-KR005', 'KR', 'Ultra Rare', 7.0)").run();
  await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const lob = db.prepare(LOB).get();
  assert.equal(lob.price, 9.0);
  assert.equal(lob.cm_estimate, 0);
  const kr = db.prepare("SELECT price, cm_estimate FROM cards WHERE language = 'KR'").get();
  assert.deepEqual(kr, { price: 7.0, cm_estimate: 0 });
});

test('Schaetzung: alle Trends 0/fehlend -> nichts geschrieben', async () => {
  const db = makeDb();
  const f = { ...files, guide: [{ idProduct: 102800, trend: 0 }, { idProduct: 577923, trend: null }] };
  const res = await runBulkRefresh(db, { userDataPath: null, files: f });
  const lob = db.prepare(LOB).get();
  assert.equal(lob.price, 9.0);
  assert.equal(lob.cm_estimate, 0);
  assert.equal(res.estimated, 0);
  const { applyEstimates } = require('./cardmarket-bulk.cjs');
  assert.equal(typeof applyEstimates, 'function');
});

test('Schaetzung: zweiter Lauf ohne Aenderung schreibt nicht', async () => {
  const db = makeDb();
  await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const stamp = () => db.prepare("SELECT updated_at FROM cards WHERE set_code = 'LOB-DE005'").get();
  const hist = () => db.prepare("SELECT COUNT(*) AS n FROM price_history").get().n;
  db.prepare("UPDATE cards SET updated_at = '2000-01-01 00:00:00' WHERE set_code = 'LOB-DE005'").run();
  const before = { s: stamp(), h: hist() };
  const res = await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  assert.deepEqual({ s: stamp(), h: hist() }, before);
  assert.equal(res.estimated, 0);
});

test('Schaetzung wird zurueckgesetzt, wenn resolveMissing/deriveMissing eine ID vergibt', async () => {
  const db = makeDb();
  db.prepare("UPDATE cards SET cm_estimate = 1, cm_estimate_max = 40 WHERE set_code = 'MRD-DE001'").run(); // loest eindeutig auf
  await runBulkRefresh(db, { userDataPath: null, files: estFiles });
  const mrd = db.prepare("SELECT cm_estimate, cm_estimate_max, cm_product_id FROM cards WHERE set_code = 'MRD-DE001'").get();
  assert.deepEqual(mrd, { cm_estimate: 0, cm_estimate_max: null, cm_product_id: 102801 });
});
