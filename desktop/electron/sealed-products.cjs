// desktop/electron/sealed-products.cjs
// Spec G3 §3/§7.2 — die Cardmarket-Produktliste fuer Sealed am Desktop, gelesen aus dem Cache, den der
// Bulk-Lauf (cardmarket-bulk.cjs) unter <userData>/cardmarket anlegt. Hier wird nichts heruntergeladen:
// fehlt der Cache, gibt es keine Liste (null) und der Katalog bekommt []. Art und Trend: catalog-build.cjs.
const fs = require('fs');
const path = require('path');
const { buildSealedProducts } = require('./catalog-build.cjs');
const { kindLabel } = require('./sealed-value.cjs');

// Der Price-Guide ist ~17 MB: einmal parsen und behalten, bis sich eine der beiden Dateien aendert.
let cache = null;

function readSealedProducts(userDataPath) {
  if (!userDataPath) return null;
  const dir = path.join(userDataPath, 'cardmarket');
  const nonsinglesPath = path.join(dir, 'products_nonsingles_3.json');
  const guidePath = path.join(dir, 'price_guide_3.json');
  let key;
  try { key = `${dir}|${fs.statSync(nonsinglesPath).mtimeMs}|${fs.statSync(guidePath).mtimeMs}`; }
  catch { return null; }
  if (cache && cache.key === key) return cache.products;
  try {
    const nonsingles = JSON.parse(fs.readFileSync(nonsinglesPath, 'utf8')).products;
    const guides = JSON.parse(fs.readFileSync(guidePath, 'utf8')).priceGuides;
    if (!Array.isArray(nonsingles) || !Array.isArray(guides)) return null;
    cache = { key, products: buildSealedProducts(nonsingles, guides) };
    return cache.products;
  } catch (e) {
    console.error('[sealed-products] Cardmarket-Cache nicht lesbar:', e.message);
    return null;
  }
}

// Spec G3 §3: fehlt der Cache beim Katalog-Bau, bleibt sealed_products leer; der Bau scheitert nicht.
const sealedProductsForCatalog = (userDataPath) => readSealedProducts(userDataPath) || [];

// Fix M3 (final-review-report.md): der Dialog soll beim Oeffnen nur pruefen koennen, ob ueberhaupt eine
// Produktliste existiert, ohne die ~17 MB dafuer zu parsen (readSealedProducts). Nur die beiden Dateien
// statten -- das Parsen bleibt der ersten echten Suche vorbehalten (readSealedProducts/Cache oben).
function sealedProductsAvailable(userDataPath) {
  if (!userDataPath) return false;
  const dir = path.join(userDataPath, 'cardmarket');
  try {
    fs.statSync(path.join(dir, 'products_nonsingles_3.json'));
    fs.statSync(path.join(dir, 'price_guide_3.json'));
    return true;
  } catch {
    return false;
  }
}

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Name enthaelt Suchtext (ohne Gross-/Kleinschreibung), sortiert nach Name, hoechstens `limit`.
function searchSealedProducts(products, query, limit = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return (products || [])
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => cmp(a.name, b.name) || a.cm_product_id - b.cm_product_id)
    .slice(0, limit)
    .map((p) => ({ ...p, kindLabel: kindLabel(p.kind) }));
}

module.exports = { readSealedProducts, sealedProductsForCatalog, searchSealedProducts, sealedProductsAvailable };
