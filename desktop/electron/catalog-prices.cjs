// Spec E1 §5 — der Desktop liest cm_price aus DERSELBEN Katalogdatei, die er baut und hochlaedt. runCatalogBuild legt
// sie nach erfolgreichem Hochladen unter <userData>/catalog/catalog.json.gz ab; so rechnen Desktop und Handy mit
// denselben Preisen. Kein zusaetzlicher Abruf.
const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');

const catalogFilePath = (userDataPath) => path.join(userDataPath, 'catalog', 'catalog.json.gz');

function saveCatalogFile(userDataPath, buffer) {
  const file = catalogFilePath(userDataPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);   // erst vollstaendig schreiben, dann tauschen: ein Leser sieht nie eine halbe Datei
}

// Der entpackte Katalog ist gross: einmal lesen und behalten, bis sich die Datei aendert (Muster sealed-products.cjs).
let cache = null;

// Map Passcode -> cm_price (Zahl oder null); null, wenn keine lesbare Datei da ist.
function readCatalogPrices(userDataPath) {
  if (!userDataPath) return null;
  const file = catalogFilePath(userDataPath);
  let key;
  try { const st = fs.statSync(file); key = `${file}|${st.mtimeMs}|${st.size}`; }
  catch { return null; }
  if (cache && cache.key === key) return cache.prices;
  try {
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    const prices = new Map();
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(String(c.id), typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
    }
    cache = { key, prices };
    return prices;
  } catch (e) {
    console.error('[catalog-prices] Katalogdatei nicht lesbar:', e.message);
    return null;
  }
}

// Fuer den Renderer: alle Preise als Objekt. available = false ohne Datei (dann ist jeder Preis unbekannt).
function catalogPrices(userDataPath) {
  const map = readCatalogPrices(userDataPath);
  if (!map) return { available: false, prices: {} };
  return { available: true, prices: Object.fromEntries(map) };
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices };
