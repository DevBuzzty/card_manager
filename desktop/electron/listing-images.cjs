// desktop/electron/listing-images.cjs — Spec H3a §5.6: Katalogbilder eines Angebots in
// Bilder\Yu-Gi-Oh Angebote\<Titel>\ speichern. Rein bis auf die hereingereichten deps (Test: Faelschungen, nie die Platte).
const path = require('path');

// Windows-sicherer Ordnername: verbotene Zeichen und Steuerzeichen -> Leerzeichen, Leerraum zusammengefasst,
// hoechstens 80 Zeichen, keine Punkte/Leerzeichen am Ende; leer -> "Angebot". Windows-Reservenamen (CON, PRN, AUX,
// NUL, COM1-9, LPT1-9; Gross/Klein egal, auch mit Endung) bekommen ein "_" angehaengt: "con.txt" -> "con_.txt".
function safeFolderName(title) {
  const FORBIDDEN = '<>:"/\\|?*';
  const s = Array.from(String(title ?? ''), (ch) => (ch.charCodeAt(0) < 32 || FORBIDDEN.includes(ch) ? ' ' : ch)).join('')
    .replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '')
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/i, '$1_');
  return s || 'Angebot';
}
const extOf = (url) => { const m = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(url); return m ? `.${m[1].toLowerCase()}` : '.jpg'; };
// "01.jpg", "02.png" … -- Zwilling der Dateinamen am Handy: ListingShare.fileName.
const imageFileName = (index, url) => `${String(index + 1).padStart(2, '0')}${extOf(url)}`;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Liest den Koerper hoechstens bis maxBytes; darueber null (Strom abgebrochen) -- nie blind arrayBuffer.
async function readLimited(r, maxBytes) {
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// deps = { fetch(url) -> Response, mkdir(dir), writeFile(file, Buffer) }. Nicht ladbare Bilder werden
// uebersprungen (Spec §5.6), nur https, nur content-type image/*, hoechstens 10 MB. -> { saved, total, folder }.
async function saveListingImages({ baseDir, title, urls }, deps) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u !== ''))];
  const folder = path.join(baseDir, 'Yu-Gi-Oh Angebote', safeFolderName(title));
  deps.mkdir(folder);
  let saved = 0;
  for (let i = 0; i < list.length; i++) {
    if (!/^https:\/\//i.test(list[i])) continue;
    try {
      const r = await deps.fetch(list[i]);
      if (!r || !r.ok) continue;
      if (!/^image\//i.test(r.headers.get('content-type') ?? '')) continue;
      if (Number(r.headers.get('content-length')) > MAX_IMAGE_BYTES) continue;
      const buf = await readLimited(r, MAX_IMAGE_BYTES);
      if (!buf || buf.length === 0) continue;
      deps.writeFile(path.join(folder, imageFileName(i, list[i])), buf);
      saved += 1;
    } catch { /* Bild uebersprungen */ }
  }
  return { saved, total: list.length, folder };
}

module.exports = { safeFolderName, imageFileName, saveListingImages };
