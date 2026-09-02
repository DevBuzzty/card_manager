// desktop/electron/cardmarket-bulk.cjs
// Daily Cardmarket price refresh WITHOUT scraping: downloads Cardmarket's free JSON files, resolves
// each printing's idProduct where unambiguous (Step A) and applies the price-guide `trend` to every
// resolved printing in one transaction (Step B). Ambiguous printings stay NULL for the scraper.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { cachedFetch, fetchCardData } = require('./api-handler.cjs');
const { buildExpansionIndex, buildSinglesIndex, resolveProduct } = require('./cardmarket-bulk-parse.cjs');

const H = 3600 * 1000;
const FILES = {
  guide:      { url: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json',           file: 'price_guide_3.json',        maxAgeMs: 24 * H,     key: 'priceGuides' },
  singles:    { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_3.json',    file: 'products_singles_3.json',   maxAgeMs: 7 * 24 * H, key: 'products' },
  nonsingles: { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json', file: 'products_nonsingles_3.json', maxAgeMs: 7 * 24 * H, key: 'products' },
};
const CARDSETS_URL = 'https://db.ygoprodeck.com/api/v7/cardsets.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0';

// Download to "<dest>.tmp", rename on success — a failed download never destroys a good cache.
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, dest); resolve(); } catch (e) { reject(e); } }));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Return the array under spec.key, downloading when the cache is missing/stale (or forced).
// A stale cache is kept if the download fails; a corrupt/unexpected file is deleted and throws.
async function loadFile(dir, spec, force) {
  const p = path.join(dir, spec.file);
  let fresh = false;
  try { fresh = (Date.now() - fs.statSync(p).mtimeMs) < spec.maxAgeMs; } catch { /* missing */ }
  if (force || !fresh) {
    try { await download(spec.url, p); }
    catch (e) { if (!fs.existsSync(p)) throw e; console.warn('[cardmarket-bulk] download failed, using cached', spec.file, e.message); }
  }
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!json || !Array.isArray(json[spec.key])) throw new Error(`unexpected shape in ${spec.file}`);
    return json[spec.key];
  } catch (e) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    throw e;
  }
}

async function loadAll(userDataPath, force) {
  const dir = path.join(userDataPath, 'cardmarket');
  fs.mkdirSync(dir, { recursive: true });
  const guide = await loadFile(dir, FILES.guide, force);        // manual "Jetzt aktualisieren" re-pulls the guide only
  const singles = await loadFile(dir, FILES.singles, false);
  const nonsingles = await loadFile(dir, FILES.nonsingles, false);
  const cardsets = await cachedFetch(CARDSETS_URL, 'cardsets', 7 * 24);  // may be null if YGOPRODeck is down
  return { guide, singles, nonsingles, cardsets };
}

function countUnresolved(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL").get().n;
}

// Step A: resolve cm_product_id for unresolved printings from the files alone (no guessing).
async function resolveMissing(db, { singles, nonsingles, cardsets }) {
  const reasons = {};
  if (!Array.isArray(cardsets)) return { resolved: 0, reasons: { 'no-cardsets': 1 } };
  const rows = db.prepare(
    "SELECT id, name, set_code, language, rarity FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL AND set_code != 'Unknown'"
  ).all();
  if (rows.length === 0) return { resolved: 0, reasons };

  const setsByPrefix = new Map();
  for (const s of cardsets) {
    const k = String(s.set_code || '').toUpperCase();
    if (!k) continue;
    if (!setsByPrefix.has(k)) setsByPrefix.set(k, []);
    setsByPrefix.get(k).push(s.set_name);
  }
  const idx = { expansionIndex: buildExpansionIndex(nonsingles), singlesIndex: buildSinglesIndex(singles) };

  const pending = [];
  for (const r of rows) {
    let cardName = r.name;
    if (!cardName) { try { cardName = (await fetchCardData(r.id))?.data?.[0]?.name || null; } catch { cardName = null; } }
    if (!cardName) { reasons['no-name'] = (reasons['no-name'] || 0) + 1; continue; }
    const setNames = setsByPrefix.get(String(r.set_code || '').split('-')[0].toUpperCase()) || [];
    const res = resolveProduct({ cardName, setNames }, idx);
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    if (res.idProduct) pending.push({ ...r, idProduct: res.idProduct });
  }
  const upd = db.prepare("UPDATE cards SET cm_product_id = ? WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?");
  db.transaction(() => { for (const p of pending) upd.run(p.idProduct, p.id, p.set_code, p.language, p.rarity); })();
  return { resolved: pending.length, reasons };
}

// Step B: price = trend for every resolved printing present in the guide with a non-null trend.
function applyPrices(db, guide) {
  const trendById = new Map();
  for (const g of guide) if (g && g.trend != null) trendById.set(Number(g.idProduct), Number(g.trend));
  const rows = db.prepare("SELECT id, set_code, language, rarity, cm_product_id FROM cards WHERE deleted = 0 AND cm_product_id IS NOT NULL").all();
  const upd = db.prepare("UPDATE cards SET price = ?, price_locked = 1, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?");
  let priced = 0, skipped = 0;
  db.transaction(() => {
    for (const r of rows) {
      const t = trendById.get(Number(r.cm_product_id));
      if (t == null) { skipped++; continue; }
      upd.run(t, r.id, r.set_code, r.language, r.rarity);
      priced++;
    }
  })();
  return { priced, skipped };
}

// Entry point. `files` (tests only) injects { guide, singles, nonsingles, cardsets } or { error }.
async function runBulkRefresh(db, { userDataPath, force = false, files = null } = {}) {
  let data;
  try {
    if (files && files.error) throw files.error;
    data = files || await loadAll(userDataPath, force);
  } catch (e) {
    console.error('[cardmarket-bulk] load failed:', e.message);
    return { error: 'download', message: e.message, resolved: 0, priced: 0, skipped: 0, unresolved: countUnresolved(db), reasons: {} };
  }
  const a = await resolveMissing(db, data);
  const b = applyPrices(db, data.guide);
  db.prepare("INSERT INTO settings (key, value) VALUES ('cm_bulk_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString());
  const out = { resolved: a.resolved, reasons: a.reasons, priced: b.priced, skipped: b.skipped, unresolved: countUnresolved(db) };
  console.log('[cardmarket-bulk]', JSON.stringify(out));
  return out;
}

function getBulkStatus(db) {
  const last = db.prepare("SELECT value FROM settings WHERE key = 'cm_bulk_last_run'").get();
  const c = db.prepare(
    "SELECT SUM(cm_product_id IS NOT NULL) AS r, SUM(cm_product_id IS NULL) AS u FROM cards WHERE deleted = 0 AND quantity > 0"
  ).get();
  return { lastRun: last ? last.value : null, resolvedCount: c.r || 0, unresolvedCount: c.u || 0 };
}

module.exports = { runBulkRefresh, getBulkStatus };
