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
// Spec E2 §4: derselbe Lesevorgang fuellt auch den Katalog-Index (Namen, Typ, Bild je Passcode) fuer den Import.
let cache = null;

// { prices: Map Passcode -> cm_price|null, cards: Map Passcode -> { id, name_de, name_en, type, image } } oder null,
// wenn keine lesbare Datei da ist.
function readCatalog(userDataPath) {
  if (!userDataPath) return null;
  const file = catalogFilePath(userDataPath);
  let key;
  try { const st = fs.statSync(file); key = `${file}|${st.mtimeMs}|${st.size}`; }
  catch { return null; }
  if (cache && cache.key === key) return cache;
  try {
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    const prices = new Map();
    const cards = new Map();
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(id, typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
      cards.set(id, { id, name_de: c.name_de || '', name_en: c.name_en || '', type: c.type || '', image: c.image || null });
    }
    cache = { key, prices, cards };
    return cache;
  } catch (e) {
    console.error('[catalog-prices] Katalogdatei nicht lesbar:', e.message);
    return null;
  }
}

// Map Passcode -> cm_price (Zahl oder null); null, wenn keine lesbare Datei da ist.
function readCatalogPrices(userDataPath) {
  const catalog = readCatalog(userDataPath);
  return catalog ? catalog.prices : null;
}

// Map Passcode -> { id, name_de, name_en, type, image }; null ohne lesbare Datei.
function readCatalogCards(userDataPath) {
  const catalog = readCatalog(userDataPath);
  return catalog ? catalog.cards : null;
}

// Spec E2 §4 -- fuer den Renderer-Import: mit ids nur diese Passcodes (samt Bild, fuer YDK/YDKE), ohne ids alle Karten
// kompakt ohne Bild (Textliste, ~1,5 MB). available = false ohne Datei ("Katalog fehlt").
function catalogCards(userDataPath, ids) {
  const cards = readCatalogCards(userDataPath);
  if (!cards) return { available: false, cards: [] };
  if (Array.isArray(ids)) {
    const out = [];
    for (const id of new Set(ids.map(String))) { const c = cards.get(id); if (c) out.push(c); }
    return { available: true, cards: out };
  }
  return { available: true, cards: Array.from(cards.values(), ({ id, name_de, name_en, type }) => ({ id, name_de, name_en, type })) };
}

// Fuer den Renderer: alle Preise als Objekt. available = false ohne Datei (dann ist jeder Preis unbekannt).
function catalogPrices(userDataPath) {
  const map = readCatalogPrices(userDataPath);
  if (!map) return { available: false, prices: {} };
  return { available: true, prices: Object.fromEntries(map) };
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards };
