// desktop/electron/cardmarket-bulk.test.cjs — runBulkRefresh against an in-memory DB with injected
// file data (no network, no disk). Run with ELECTRON_RUN_AS_NODE=1 (better-sqlite3 ABI).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { runBulkRefresh, getBulkStatus } = require('./cardmarket-bulk.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE cards (id TEXT, name TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT,
      quantity INTEGER DEFAULT 1, price REAL, price_locked INTEGER DEFAULT 0, cm_url TEXT,
      cm_updated_at DATETIME, cm_product_id INTEGER, deleted INTEGER DEFAULT 0,
      PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
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
