// desktop/electron/listing-images.cjs — Spec H3a §5.6: Katalogbilder eines Angebots in
// Bilder\Yu-Gi-Oh Angebote\<Titel>\ speichern. Rein bis auf die hereingereichten deps (Test: Faelschungen, nie die Platte).
const path = require('path');

// Windows-sicherer Ordnername: verbotene Zeichen und Steuerzeichen -> Leerzeichen, Leerraum zusammengefasst,
// hoechstens 80 Zeichen, keine Punkte/Leerzeichen am Ende; leer -> "Angebot".
function safeFolderName(title) {
  const FORBIDDEN = '<>:"/\\|?*';
  const s = Array.from(String(title ?? ''), (ch) => (ch.charCodeAt(0) < 32 || FORBIDDEN.includes(ch) ? ' ' : ch)).join('')
    .replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
  return s || 'Angebot';
}
const extOf = (url) => { const m = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(url); return m ? `.${m[1].toLowerCase()}` : '.jpg'; };
// "01.jpg", "02.png" … -- Zwilling der Dateinamen am Handy: ListingShare.fileName.
const imageFileName = (index, url) => `${String(index + 1).padStart(2, '0')}${extOf(url)}`;

// deps = { fetch(url) -> Response-artig, mkdir(dir), writeFile(file, Buffer) }. Nicht ladbare Bilder werden
// uebersprungen (Spec §5.6), nur https. -> { saved, total, folder }.
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
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length === 0) continue;
      deps.writeFile(path.join(folder, imageFileName(i, list[i])), buf);
      saved += 1;
    } catch { /* Bild uebersprungen */ }
  }
  return { saved, total: list.length, folder };
}

module.exports = { safeFolderName, imageFileName, saveListingImages };
