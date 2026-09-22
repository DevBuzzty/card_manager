const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const { ensureEbaySchema } = require('./ebay-schema.cjs');
const P = require('./listing-photos.cjs');

function freshDb() {
  const db = new Database(':memory:');
  ensureListingsSchema(db); ensureEbaySchema(db);
  db.prepare("INSERT INTO listings (listing_id, channel_id, channel_name, price, listed_on) VALUES ('l1', 'ebay', 'eBay', 5, '2026-09-22')").run();
  return db;
}
// Gefälschtes Bild: toJPEG liefert je Qualität eine feste Größe; resize merkt sich die Zielgröße.
function fakeDeps({ width = 4000, height = 3000, sizes = { 85: 900e3, 75: 600e3, 65: 450e3 }, fileSize = 3e6 } = {}) {
  const uploads = []; let n = 0; let resized = null;
  return {
    uploads, resizedTo: () => resized,
    deps: {
      fileSize: () => fileSize, readFile: () => Buffer.from('x'),
      decode: () => ({ width, height, resize: (s) => { resized = s; return { toJPEG: (q) => Buffer.alloc(sizes[q] ?? 100e3) }; } }),
      upload: async (p, buf) => { uploads.push([p, buf.length]); },
      uuid: () => `u${++n}`,
    },
  };
}

test('Größe: längste Seite höchstens 1600, Seitenverhältnis bleibt', () => {
  assert.deepEqual(P.scaleSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(P.scaleSize(1000, 3000), { width: 533, height: 1600 });
  assert.deepEqual(P.scaleSize(800, 600), { width: 800, height: 600 });
});

test('Qualität sinkt, bis unter 500 KB; letzte Stufe wird genommen', () => {
  const seen = [];
  assert.equal(P.encodeUnder((q) => { seen.push(q); return Buffer.alloc(q === 65 ? 400e3 : 700e3); }).length, 400e3);
  assert.deepEqual(seen, [85, 75, 65]);
  assert.equal(P.encodeUnder(() => Buffer.alloc(600e3)).length, 600e3);
});

test('Foto hinzufügen: verkleinert, hochgeladen unter <listing_id>/<uuid>.jpg, Reihenfolge hinten angehängt', async () => {
  const db = freshDb();
  const f = fakeDeps();
  const r = await P.addPhoto(db, { listingId: 'l1', filePath: 'C:\\Fotos\\a.JPG' }, f.deps);
  assert.deepEqual([r.photo_id, r.path, r.bytes], ['u1', 'l1/u1.jpg', 450e3]);
  assert.deepEqual(f.resizedTo(), { width: 1600, height: 1200 });
  assert.deepEqual(f.uploads, [['l1/u1.jpg', 450e3]]);
  await P.addPhoto(db, { listingId: 'l1', filePath: 'b.png' }, f.deps);
  assert.deepEqual(P.listPhotos(db, 'l1', 'https://proj.supabase.co/rest/v1').map((p) => [p.photo_id, p.sort, p.url]), [
    ['u1', 0, 'https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u1.jpg'],
    ['u2', 1, 'https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u2.jpg'],
  ]);
});

test('Prüfungen: Angebot, Anzahl 12, Dateityp, Größe, Mindestmaß -- ohne Hochladen', async () => {
  const db = freshDb();
  const reject = async (input, deps, msg) => {
    await assert.rejects(() => P.addPhoto(db, input, deps.deps), (e) => e instanceof P.PhotoError && e.message === msg);
    assert.equal(deps.uploads.length, 0);
  };
  await reject({ listingId: 'nix', filePath: 'a.jpg' }, fakeDeps(), 'Angebot nicht gefunden.');
  await reject({ listingId: 'l1', filePath: 'a.gif' }, fakeDeps(), 'Nur JPG- oder PNG-Bilder.');
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps({ fileSize: 30e6 }), 'Bild ist zu groß (höchstens 25 MB).');
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps({ width: 499, height: 300 }), 'Foto zu klein – mindestens 500 Pixel an der längeren Seite.');
  const ins = db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, 'l1', ?, ?)");
  for (let i = 0; i < 12; i++) ins.run(`x${i}`, `l1/x${i}.jpg`, i);
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps(), 'Höchstens 12 eigene Fotos je Angebot.');
});

test('Löschen weich, Reihenfolge nur mit genau den lebenden Fotos', () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, 'l1', ?, ?)");
  ins.run('a', 'l1/a.jpg', 0); ins.run('b', 'l1/b.jpg', 1); ins.run('c', 'l1/c.jpg', 2);
  P.deletePhoto(db, 'b');
  assert.equal(db.prepare("SELECT deleted FROM listing_photos WHERE photo_id = 'b'").get().deleted, 1);
  assert.throws(() => P.deletePhoto(db, 'b'), /Foto nicht gefunden/);
  P.reorderPhotos(db, 'l1', ['c', 'a']);
  assert.deepEqual(P.listPhotos(db, 'l1', 'https://x').map((p) => p.photo_id), ['c', 'a']);
  assert.throws(() => P.reorderPhotos(db, 'l1', ['c']), /inzwischen geändert/);
  assert.throws(() => P.reorderPhotos(db, 'l1', ['c', 'b']), /inzwischen geändert/);
});
