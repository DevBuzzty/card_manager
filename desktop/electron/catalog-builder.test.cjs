// desktop/electron/catalog-builder.test.cjs — runCatalogBuild gegen eine frische Wegwerf-DB im Temp-Ordner
// (initDatabase, damit cachedFetch die vorbefuellten Dumps findet; kein Netz) und einen Fake-Supabase-Client.
// Laeuft mit ELECTRON_RUN_AS_NODE=1 (better-sqlite3 ABI).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { initDatabase } = require('./database.cjs');
const { runCatalogBuild } = require('./catalog-builder.cjs');

const EN_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const DE_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?language=de';
const EN = [
  { id: 46986414, name: 'Dark Magician', type: 'Normal Monster', desc: 'x', card_images: [{ image_url: 'https://x/1.jpg' }],
    card_sets: [{ set_code: 'LOB-EN005', set_rarity: 'Ultra Rare' }] },
  { id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', desc: 'y', card_images: [{ image_url: 'https://x/2.jpg' }],
    card_sets: [{ set_code: 'SDK-001', set_rarity: 'Ultra Rare' }] },
];

const tmpDirs = [];
const dbs = [];
function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-builder-test-'));
  tmpDirs.push(dir);
  const db = initDatabase(dir);
  dbs.push(db);
  const ins = db.prepare('INSERT OR REPLACE INTO api_cache (key, data, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)');
  ins.run(`catalog_en:${EN_URL}`, JSON.stringify({ data: EN }));
  ins.run(`catalog_de:${DE_URL}`, JSON.stringify({ data: [] }));
  return db;
}
test.after(() => {
  for (const db of dbs) { try { db.close(); } catch { /* schon zu */ } }
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows-Sperre */ } }
});

function prevCatalogBuffer() {
  const json = JSON.stringify({ version: 11, built_at: '2026-10-01T00:00:00Z', cards: [
    { id: 46986414, printings_verified: [{ code: 'LOB-DE005', rarity: 'Ultra Rare', lang: 'DE', cm: 5 }] },
    { id: 89631139, printings_verified: [{ code: 'SDK-G001', rarity: 'Ultra Rare', lang: 'DE' }, { code: 'SDK-G001', rarity: 'Common', lang: 'DE' }] },
    { id: 99999999, printings_verified: [{ code: 'WEG-DE001', rarity: 'Rare', lang: 'DE' }] },   // nicht mehr im Dump
  ], sealed_products: [], aliases: {} });
  return zlib.gzipSync(Buffer.from(json, 'utf8'));
}

// Fake-Client: catalog_versions-Zeile (oder keine), Storage mit download/upload/getPublicUrl.
function fakeClient({ row = null, download = null, rowError = null } = {}) {
  const uploads = [];
  const upserts = [];
  const downloads = [];
  return {
    uploads, upserts, downloads,
    from(table) {
      assert.equal(table, 'catalog_versions');
      return {
        select() {
          return { eq() { return { maybeSingle: async () => (rowError ? { data: null, error: rowError } : { data: row, error: null }) }; } };
        },
        upsert: async (r) => { upserts.push(r); return { error: null }; },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'catalog');
        return {
          download: async (name) => { downloads.push(name); return download ? download(name) : { data: null, error: { message: 'not found' } }; },
          upload: async (name, buf) => { uploads.push({ name, buf }); return { error: null }; },
          getPublicUrl: (name) => ({ data: { publicUrl: `https://sb.example/storage/v1/object/public/catalog/${name}` } }),
        };
      },
    },
  };
}

function uploadedCatalog(client) {
  assert.equal(client.uploads.length, 1);
  return JSON.parse(zlib.gunzipSync(client.uploads[0].buf).toString('utf8'));
}

test('mit Vorgaenger: verifizierte DE-Drucke werden uebernommen und gemeldet', async () => {
  const db = makeDb();
  const buf = prevCatalogBuffer();
  const row = { version: 11, url: 'https://sb.example/storage/v1/object/public/catalog/catalog.v11.json.gz',
    sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  const client = fakeClient({ row, download: async () => ({ data: new Blob([buf]), error: null }) });
  const res = await runCatalogBuild(db, { ensureClient: async () => client });
  assert.equal(res.error, undefined, res.message);
  assert.deepEqual(client.downloads, ['catalog.v11.json.gz']);
  assert.equal(res.version, 12);
  assert.equal(res.cards, 2);
  assert.equal(res.verified, 0);                        // lokaler Cache leer -- Feld bleibt wie bisher
  assert.deepEqual(res.verifiedCarried, { fromVersion: 11, cards: 2, printings: 3 });
  const cat = uploadedCatalog(client);
  const byId = new Map(cat.cards.map(c => [String(c.id), c]));
  assert.deepEqual(byId.get('46986414').printings_verified.map(p => [p.code, p.rarity, p.lang]), [['LOB-DE005', 'Ultra Rare', 'DE']]);
  assert.deepEqual(byId.get('89631139').printings_verified.map(p => [p.code, p.rarity, p.lang]),
    [['SDK-G001', 'Ultra Rare', 'DE'], ['SDK-G001', 'Common', 'DE']]);
  assert.equal(byId.has('99999999'), false);
});

test('ohne Vorgaenger (keine Zeile): Bau laeuft ohne Uebernahme', async () => {
  const db = makeDb();
  const client = fakeClient({ row: null });
  const res = await runCatalogBuild(db, { ensureClient: async () => client });
  assert.equal(res.error, undefined, res.message);
  assert.equal(res.version, 1);
  assert.deepEqual(client.downloads, []);
  assert.deepEqual(res.verifiedCarried, { fromVersion: null, cards: 0, printings: 0 });
  assert.ok(uploadedCatalog(client).cards.every(c => c.printings_verified.length === 0));
});

test('Download-Fehler bricht ab, ohne hochzuladen oder die Version zu verbuchen', async () => {
  const db = makeDb();
  const client = fakeClient({ row: { version: 11, url: 'https://sb.example/x/catalog.v11.json.gz', sha256: null } });
  const res = await runCatalogBuild(db, { ensureClient: async () => client });
  assert.equal(res.error, 'previous-catalog');
  assert.match(res.message, /Vorgänger-Katalog/);
  assert.equal(client.uploads.length, 0);
  assert.equal(client.upserts.length, 0);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'catalog_version'").get(), undefined);
});

test('kaputter Vorgaenger (kein gzip) und falsche Pruefsumme brechen ab', async () => {
  for (const [buf, sha] of [[Buffer.from('kein gzip'), null], [prevCatalogBuffer(), 'ab'.repeat(32)]]) {
    const db = makeDb();
    const client = fakeClient({ row: { version: 11, url: 'https://sb.example/x/catalog.v11.json.gz', sha256: sha },
      download: async () => ({ data: new Blob([buf]), error: null }) });
    const res = await runCatalogBuild(db, { ensureClient: async () => client });
    assert.equal(res.error, 'previous-catalog');
    assert.equal(client.uploads.length, 0);
  }
});

test('Lesefehler bei catalog_versions bricht ebenfalls ab (Vorgaenger unbekannt)', async () => {
  const db = makeDb();
  const client = fakeClient({ rowError: { message: 'network' } });
  const res = await runCatalogBuild(db, { ensureClient: async () => client });
  assert.equal(res.error, 'previous-catalog');
  assert.equal(client.uploads.length, 0);
});
