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
// Spec E3 §3: dazu Banlist je Karte, die Artwork-Zuordnung und das Baudatum.
let cache = null;

// { prices: Map Passcode -> cm_price|null, cards: Map Passcode -> { id, name_de, name_en, type, image, ban_tcg, ban_ocg },
//   aliases: Map Artwork-Passcode -> Haupt-Passcode, legality: bool (Katalog traegt aliases, also auch Ban-Felder),
//   builtAt } oder null, wenn keine lesbare Datei da ist.
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
    const banOf = (v) => (v === 'forbidden' || v === 'limited' || v === 'semi' ? v : null);
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(id, typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
      cards.set(id, {
        id, name_de: c.name_de || '', name_en: c.name_en || '', type: c.type || '', image: c.image || null,
        ban_tcg: banOf(c.ban_tcg), ban_ocg: banOf(c.ban_ocg),
      });
    }
    // Katalog von vor E3: kein aliases-Objekt -> legality false ("Katalog fehlt – Banlist unbekannt").
    const legality = !!json.aliases && typeof json.aliases === 'object' && !Array.isArray(json.aliases);
    const aliases = new Map();
    if (legality) {
      for (const [alt, main] of Object.entries(json.aliases)) if (cards.has(String(main))) aliases.set(String(alt), String(main));
    }
    cache = { key, prices, cards, aliases, legality, builtAt: typeof json.built_at === 'string' ? json.built_at : null, legalityIndex: null };
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

// Spec E3 §3: Haupt-Passcode eines Deckkarten-Passcodes (Artwork -> Hauptkarte), sonst der Passcode selbst.
// Gleiche Regel wie deckImport.js#canonicalPasscode; ohne lesbare Datei unveraendert.
function catalogMainId(userDataPath, id) {
  const catalog = readCatalog(userDataPath);
  const key = String(id);
  return (catalog && catalog.aliases.get(key)) || key;
}

// Spec E2 §4 -- fuer den Renderer-Import: mit ids nur diese Passcodes (samt Bild, fuer YDK/YDKE), ohne ids alle Karten
// kompakt ohne Bild (Textliste, ~1,5 MB). available = false ohne Datei ("Katalog fehlt").
// Spec E3 §3: mit ids laufen Artwork-Passcodes ueber die Zuordnung -- geliefert wird die Hauptkarte, und `aliases`
// nennt fuer jeden angefragten Artwork-Passcode seinen Haupt-Passcode (die Aufloesung selbst macht deckImport.js).
function catalogCards(userDataPath, ids) {
  const catalog = readCatalog(userDataPath);
  if (!catalog) return { available: false, cards: [], aliases: {} };
  const pick = ({ id, name_de, name_en, type }) => ({ id, name_de, name_en, type });
  if (Array.isArray(ids)) {
    const out = [];
    const aliases = {};
    const seen = new Set();
    for (const raw of new Set(ids.map(String))) {
      const main = catalog.aliases.get(raw);
      if (main) aliases[raw] = main;
      const id = main || raw;
      const c = catalog.cards.get(id);
      if (c && !seen.has(id)) { seen.add(id); out.push({ ...pick(c), image: c.image }); }
    }
    return { available: true, cards: out, aliases };
  }
  return { available: true, cards: Array.from(catalog.cards.values(), pick), aliases: {} };
}

// Spec E3 §4/§7 -- fuer die Legalitaet im Renderer: alle Karten mit Name, Typ und Banlist, die ganze Artwork-Zuordnung
// und das Baudatum ("Banlist-Stand"). available = false ohne Datei ODER mit einem Katalog von vor E3 (ohne aliases):
// dann gilt "Katalog fehlt – Banlist unbekannt". Einmal je Katalogdatei gebaut und behalten.
function catalogLegality(userDataPath) {
  const catalog = readCatalog(userDataPath);
  if (!catalog || !catalog.legality) return { available: false, builtAt: null, aliases: {}, cards: {} };
  if (!catalog.legalityIndex) {
    const cards = {};
    for (const c of catalog.cards.values()) {
      cards[c.id] = { name: c.name_de || c.name_en || null, type: c.type || null, ban_tcg: c.ban_tcg, ban_ocg: c.ban_ocg };
    }
    catalog.legalityIndex = { available: true, builtAt: catalog.builtAt, aliases: Object.fromEntries(catalog.aliases), cards };
  }
  return catalog.legalityIndex;
}

// Passcodes zu einem Namensstueck, deutsche Treffer zuerst. Die Sammlung speichert nur den ENGLISCHEN
// Namen, und YGOPRODecks Suche mit language=de findet manche deutschen Namen nicht ("Adreus, Hueter der
// Goetterdaemmerung", "Ueberfallritter" -- Nutzer 19.09.2026). Der Offline-Katalog kennt beide Namen, also
// suchen wir hier lokal und holen die gefundenen Passcodes danach als ganze Karten.
// Leer ohne Katalogdatei oder bei weniger als zwei Zeichen.
function catalogSearchNames(userDataPath, query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const catalog = readCatalog(userDataPath);
  if (!catalog) return [];
  const de = [], en = [];
  for (const c of catalog.cards.values()) {
    if (c.name_de && c.name_de.toLowerCase().includes(q)) de.push(c.id);
    else if (c.name_en && c.name_en.toLowerCase().includes(q)) en.push(c.id);
    if (de.length >= limit) break;
    if (en.length > limit) en.length = limit;   // englische Treffer nur als Auffuellung
  }
  return [...de, ...en].slice(0, limit);
}

// Fuer den Renderer: alle Preise als Objekt. available = false ohne Datei (dann ist jeder Preis unbekannt).
function catalogPrices(userDataPath) {
  const map = readCatalogPrices(userDataPath);
  if (!map) return { available: false, prices: {} };
  return { available: true, prices: Object.fromEntries(map) };
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogSearchNames, catalogPrices, catalogCards, catalogMainId, catalogLegality };
