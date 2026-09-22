// desktop/electron/listing-photos.cjs — Spec H3b1 §6: eigene Fotos je Angebot (höchstens 12), vor dem Hochladen auf
// höchstens 1600 px lange Seite verkleinert, JPEG unter 500 KB; eBay verlangt mindestens 500 px. Löschen ist weich.
// Rein bis auf die hereingereichten deps (Test: Fälschungen, nie Platte/Netz). Gegenstück am Handy: ml/PhotoScale.kt
// (gleiche Grenzen, gleiche Qualitätsstufen, gleicher Pfad) und cloud/EbayRepository.kt.
const path = require('path');

const MAX_PHOTOS = 12;
const MAX_EDGE = 1600;
const MIN_EDGE = 500;
const TARGET_BYTES = 500 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const QUALITIES = [85, 75, 65, 55, 50];
const EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const BUCKET = 'listing-photos';

class PhotoError extends Error {}

function scaleSize(width, height, maxEdge = MAX_EDGE) {
  const m = Math.max(width, height);
  if (m <= maxEdge) return { width, height };
  const f = maxEdge / m;
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}
// Qualität stufenweise senken, bis das JPEG unter dem Ziel liegt; die letzte Stufe wird genommen, wie sie ist.
function encodeUnder(encode, target = TARGET_BYTES) {
  let last = null;
  for (const q of QUALITIES) { last = encode(q); if (last.length < target) return last; }
  return last;
}
const photoPath = (listingId, uuid) => `${listingId}/${uuid}.jpg`;
// Öffentliche Adresse -- dieselbe wie supabase/functions/_shared/ebay-map.ts#photoUrl und ml/PhotoScale.kt#publicUrl (hier zusätzlich ohne /rest/v1).
function publicPhotoUrl(baseUrl, p) {
  return `${String(baseUrl || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')}/storage/v1/object/public/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
}

// Fixrunde 1 §1: nativeImage.createFromBuffer()/toJPEG() ignorieren das EXIF-Orientation-Tag und verwerfen es beim
// Kodieren -- Hochformat-Handyfotos (meist als "Querformat-Bitmap + Orientation-Tag" gespeichert) landen seitlich
// auf eBay. jpegOrientation liest das Tag darum aus dem ROHEN Dateipuffer (bevor nativeImage ihn dekodiert und den
// Block verwirft); main.cjs#photoDeps wendet orientBitmap auf die dekodierte Bitmap an, bevor sie skaliert wird.
// Reine Funktionen, kein Zugriff auf Platte/Netz -- direkt testbar (siehe listing-photos.test.cjs).
function jpegOrientation(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return 1;
    let offset = 2;
    while (offset + 4 <= buf.length) {
      if (buf[offset] !== 0xFF) return 1; // kein gueltiger Marker mehr -- kaputt
      const marker = buf[offset + 1];
      if (marker === 0xD9 || marker === 0xDA) return 1; // EOI bzw. SOS: kein APP1 gefunden
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue; } // TEM/RST: ohne Laenge
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buf.length) return 1; // Laenge zeigt hinter das Ende -- kaputt
      if (marker === 0xE1) return exifOrientationTag(buf, offset + 4, offset + 2 + segLen);
      offset += 2 + segLen;
    }
    return 1;
  } catch { return 1; }
}
// Orientation-Tag (0x0112) aus einem APP1-Segment [start, end) mit vorangestelltem "Exif\0\0" + TIFF-Header lesen.
function exifOrientationTag(buf, start, end) {
  if (end - start < 8 || buf.toString('ascii', start, start + 4) !== 'Exif') return 1;
  const tiffStart = start + 6;
  const order = buf.toString('ascii', tiffStart, tiffStart + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifdStart = tiffStart + u32(tiffStart + 4);
  if (ifdStart < 0 || ifdStart + 2 > end) return 1;
  const count = u16(ifdStart);
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
// Dreht/spiegelt eine dekodierte BGRA-Bitmap (4 Byte je Pixel) laut EXIF-Orientation (1..8) in ein neues Bitmap.
// Formeln je Ausrichtung (Ausgabe-Pixel (ox,oy) -> Quell-Pixel (ix,iy)), hergeleitet aus den ueblichen
// Canvas-Transformationsmatrizen fuer EXIF-Orientation; 5/6/7/8 tauschen Breite/Hoehe.
function orientBitmap(bitmap, width, height, orientation) {
  const swapped = orientation >= 5 && orientation <= 8;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const data = Buffer.alloc(outWidth * outHeight * 4);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let ix; let iy;
      switch (orientation) {
        case 2: ix = width - 1 - ox; iy = oy; break;
        case 3: ix = width - 1 - ox; iy = height - 1 - oy; break;
        case 4: ix = ox; iy = height - 1 - oy; break;
        case 5: ix = oy; iy = ox; break;
        case 6: ix = oy; iy = height - 1 - ox; break;
        case 7: ix = width - 1 - oy; iy = height - 1 - ox; break;
        case 8: ix = width - 1 - oy; iy = ox; break;
        default: ix = ox; iy = oy;
      }
      bitmap.copy(data, (oy * outWidth + ox) * 4, (iy * width + ix) * 4, (iy * width + ix) * 4 + 4);
    }
  }
  return { data, width: outWidth, height: outHeight };
}

function livePhotos(db, listingId) {
  return db.prepare('SELECT * FROM listing_photos WHERE listing_id = ? AND deleted = 0 ORDER BY sort, photo_id').all(listingId);
}
function listPhotos(db, listingId, baseUrl) {
  return livePhotos(db, listingId).map((p) => ({ photo_id: p.photo_id, path: p.path, sort: p.sort, url: publicPhotoUrl(baseUrl, p.path) }));
}

// deps = { fileSize(file) -> Bytes, readFile(file) -> Buffer, decode(buf) -> { width, height, resize({width,height}) -> img,
//          toJPEG(q) -> Buffer } | null, upload(path, jpeg) -> Promise, uuid() -> string }
async function addPhoto(db, { listingId, filePath }, deps) {
  const l = db.prepare('SELECT listing_id FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
  if (!l) throw new PhotoError('Angebot nicht gefunden.');
  if (livePhotos(db, listingId).length >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} eigene Fotos je Angebot.`);
  if (!EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase())) throw new PhotoError('Nur JPG- oder PNG-Bilder.');
  if (deps.fileSize(filePath) > MAX_INPUT_BYTES) throw new PhotoError('Bild ist zu groß (höchstens 25 MB).');
  const img = deps.decode(deps.readFile(filePath));
  if (!img || !(img.width > 0) || !(img.height > 0)) throw new PhotoError('Bild konnte nicht gelesen werden.');
  if (Math.max(img.width, img.height) < MIN_EDGE) throw new PhotoError('Foto zu klein – mindestens 500 Pixel an der längeren Seite.');
  const scaled = img.resize(scaleSize(img.width, img.height));
  const jpeg = encodeUnder((q) => scaled.toJPEG(q));
  const photoId = deps.uuid();
  const p = photoPath(listingId, photoId);
  await deps.upload(p, jpeg);
  // Erst nach dem Hochladen die Zeile: ohne Datei gibt es kein Foto. Frisch zählen (ein zweites Fenster/Handy).
  db.transaction(() => {
    if (livePhotos(db, listingId).length >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} eigene Fotos je Angebot.`);
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM listing_photos WHERE listing_id = ? AND deleted = 0').get(listingId).s;
    db.prepare('INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, ?, ?, ?)').run(photoId, listingId, p, sort);
  })();
  return { photo_id: photoId, path: p, bytes: jpeg.length };
}

function deletePhoto(db, photoId) {
  const r = db.prepare('UPDATE listing_photos SET deleted = 1 WHERE photo_id = ? AND deleted = 0').run(photoId);
  if (r.changes === 0) throw new PhotoError('Foto nicht gefunden.');
}

// Neue Reihenfolge = genau die lebenden Fotos des Angebots; nur geänderte Zeilen werden gestempelt.
function reorderPhotos(db, listingId, photoIds) {
  db.transaction(() => {
    const live = livePhotos(db, listingId).map((p) => p.photo_id);
    const ids = Array.isArray(photoIds) ? photoIds : [];
    if (ids.length !== live.length || new Set(ids).size !== ids.length || ids.some((id) => !live.includes(id))) {
      throw new PhotoError('Fotos wurden inzwischen geändert – bitte neu öffnen.');
    }
    const upd = db.prepare('UPDATE listing_photos SET sort = ? WHERE photo_id = ? AND sort <> ?');
    ids.forEach((id, i) => upd.run(i, id, i));
  })();
}

module.exports = {
  PhotoError, MAX_PHOTOS, MAX_EDGE, MIN_EDGE, TARGET_BYTES, QUALITIES, scaleSize, encodeUnder, photoPath, publicPhotoUrl,
  listPhotos, addPhoto, deletePhoto, reorderPhotos,
  jpegOrientation, orientBitmap,
};
