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

// Fixrunde 1 §1: EXIF-Ausrichtung -- Hochformat-Handyfotos ohne Korrektur landen seitlich auf eBay.
// Kleine, handgebaute JPEG-Header statt echter Bilddateien (keine Testfixtures im Repo, keine Netz-/Plattenzugriffe).
function u16(little) { return (buf, off, v) => (little ? buf.writeUInt16LE(v, off) : buf.writeUInt16BE(v, off)); }
function u32(little) { return (buf, off, v) => (little ? buf.writeUInt32LE(v, off) : buf.writeUInt32BE(v, off)); }
function buildExifJpeg(orientation, little) {
  const w16 = u16(little); const w32 = u32(little);
  const header = Buffer.alloc(8);
  header.write(little ? 'II' : 'MM', 0, 'ascii'); w16(header, 2, 42); w32(header, 4, 8); // IFD folgt direkt nach dem Header
  const entry = Buffer.alloc(12);
  w16(entry, 0, 0x0112); w16(entry, 2, 3); w32(entry, 4, 1); w16(entry, 8, orientation); w16(entry, 10, 0);
  const ifdCount = Buffer.alloc(2); w16(ifdCount, 0, 1);
  const nextIfd = Buffer.alloc(4); // kein weiteres IFD
  const exifBlob = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), header, ifdCount, entry, nextIfd]);
  const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(exifBlob.length + 2, 0); // Laenge zaehlt sich selbst mit
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), Buffer.from([0xFF, 0xE1]), lenBuf, exifBlob, Buffer.from([0xFF, 0xD9])]);
}

test('jpegOrientation: Tag 0x0112 in beiden Byte-Reihenfolgen, ohne EXIF und kaputt -> 1', () => {
  assert.equal(P.jpegOrientation(buildExifJpeg(6, true)), 6, 'II (little-endian)');
  assert.equal(P.jpegOrientation(buildExifJpeg(8, false)), 8, 'MM (big-endian)');
  assert.equal(P.jpegOrientation(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9])), 1, 'kein APP1 -> 1');
  assert.equal(P.jpegOrientation(Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF])), 1, 'Laenge zeigt hinters Ende -> 1');
  assert.equal(P.jpegOrientation(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0d, 0x0a])), 1, 'kein JPEG (PNG-Signatur) -> 1');
});

// 2x3-Bitmap (Breite 2, Hoehe 3), ein Byte je Pixel als eindeutige Marke (A..F), BGRA mit 3 Fuellbytes.
function pixelBitmap(labels) {
  const buf = Buffer.alloc(labels.length * 4);
  labels.forEach((l, i) => { buf[i * 4] = l; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 255; });
  return buf;
}
const [A, B, C, D, E, F] = [10, 11, 12, 13, 14, 15];
// Reihenfolge row-major: (0,0)=A (1,0)=B / (0,1)=C (1,1)=D / (0,2)=E (1,2)=F
const GRID = pixelBitmap([A, B, C, D, E, F]);
const marks = (buf, w, h) => { const out = []; for (let i = 0; i < w * h; i++) out.push(buf[i * 4]); return out; };

test('orientBitmap: Spiegelung (2), 180 (3), 90 CW (6), 90 CCW (8) auf 2x3-Bitmap -- exakte Pixelpositionen', () => {
  const r2 = P.orientBitmap(GRID, 2, 3, 2);
  assert.deepEqual([r2.width, r2.height, marks(r2.data, r2.width, r2.height)], [2, 3, [B, A, D, C, F, E]]);
  const r3 = P.orientBitmap(GRID, 2, 3, 3);
  assert.deepEqual([r3.width, r3.height, marks(r3.data, r3.width, r3.height)], [2, 3, [F, E, D, C, B, A]]);
  const r6 = P.orientBitmap(GRID, 2, 3, 6);
  assert.deepEqual([r6.width, r6.height, marks(r6.data, r6.width, r6.height)], [3, 2, [E, C, A, F, D, B]]);
  const r8 = P.orientBitmap(GRID, 2, 3, 8);
  assert.deepEqual([r8.width, r8.height, marks(r8.data, r8.width, r8.height)], [3, 2, [B, D, F, A, C, E]]);
  const r1 = P.orientBitmap(GRID, 2, 3, 1);
  assert.deepEqual([r1.width, r1.height, marks(r1.data, r1.width, r1.height)], [2, 3, [A, B, C, D, E, F]]);
});
