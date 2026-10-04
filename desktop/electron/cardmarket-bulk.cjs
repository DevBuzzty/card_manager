// desktop/electron/cardmarket-bulk.cjs
// Daily Cardmarket price refresh WITHOUT scraping: downloads Cardmarket's free JSON files, resolves
// each printing's idProduct where unambiguous (Step A) and applies the price-guide `trend` to every
// resolved printing in one transaction (Step B). Ambiguous printings stay NULL for the scraper.
// Step C (Spec G3 §5) applies the same guide's trend to every live sealed_items row (sealed-items.cjs).
const fs = require('fs');
const path = require('path');
const https = require('https');
const { cachedFetch, fetchCardData } = require('./api-handler.cjs');
const { buildExpansionIndex, buildSinglesIndex, resolveProduct, buildVersionIndex, learnRanks, deriveProduct, versionsAreRarities, orderForLearning, idFromVersionRow, cmForPrinting } = require('./cardmarket-bulk-parse.cjs');
const { normName } = require('./cardmarket-parse.cjs');
const { recordPrice } = require('./price-history.cjs');
const { applySealedPrices } = require('./sealed-items.cjs');
const { applyLangFactor, isKoreanCode } = require('./language-kr.cjs');

const H = 3600 * 1000;
const FILES = {
  guide:      { url: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json',           file: 'price_guide_3.json',        maxAgeMs: 24 * H,     key: 'priceGuides' },
  singles:    { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_3.json',    file: 'products_singles_3.json',   maxAgeMs: 7 * 24 * H, key: 'products' },
  nonsingles: { url: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json', file: 'products_nonsingles_3.json', maxAgeMs: 7 * 24 * H, key: 'products' },
};
const CARDSETS_URL = 'https://db.ygoprodeck.com/api/v7/cardsets.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0';

// Download to "<dest>.tmp", rename on success — a failed, aborted, or truncated download never
// destroys a good cache (the .tmp file is removed on any error path).
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    const fail = (e) => { fs.unlink(tmp, () => {}); reject(e); };
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const expected = Number(res.headers['content-length']);
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      res.on('aborted', () => fail(new Error(`aborted download for ${url}`)));
      out.on('finish', () => out.close(() => {
        if (Number.isFinite(expected) && expected >= 0 && out.bytesWritten !== expected) {
          return fail(new Error(`truncated download for ${url}: got ${out.bytesWritten} of ${expected} bytes`));
        }
        try { fs.renameSync(tmp, dest); resolve(); } catch (e) { fail(e); }
      }));
      out.on('error', fail);
      res.on('error', fail);
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

// KR-Drucke laufen nicht ueber Cardmarket (kein Koreanisch dort), sondern ueber kr-prices.cjs.
function countUnresolved(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL AND set_code != 'Unknown' AND language != 'KR'").get().n;
}

const UNRESOLVED_SQL = "SELECT id, name, set_code, language, rarity FROM cards WHERE deleted = 0 AND quantity > 0 AND cm_product_id IS NULL AND set_code != 'Unknown' AND language != 'KR'";
const prefixOf = (setCode) => String(setCode || '').split('-')[0].toUpperCase();

// Lookup structures shared by Step A, Step A2 and the scraper's deriver. null without cardsets.
function buildIndexes({ singles, nonsingles, cardsets }) {
  if (!Array.isArray(cardsets)) return null;
  const setsByPrefix = new Map();
  for (const s of cardsets) {
    const k = String(s.set_code || '').toUpperCase();
    if (!k) continue;
    if (!setsByPrefix.has(k)) setsByPrefix.set(k, []);
    setsByPrefix.get(k).push(s.set_name);
  }
  return {
    setsByPrefix,
    expansionIndex: buildExpansionIndex(nonsingles),
    singlesIndex: buildSinglesIndex(singles),
    versionIndex: buildVersionIndex(singles),
  };
}

// Step A: resolve cm_product_id for unresolved printings from the files alone (no guessing).
async function resolveMissing(db, ix) {
  const reasons = {};
  if (!ix) return { resolved: 0, reasons: { 'no-cardsets': 1 } };
  const rows = db.prepare(UNRESOLVED_SQL).all();
  if (rows.length === 0) return { resolved: 0, reasons };

  const pending = [];
  for (const r of rows) {
    let cardName = r.name;
    if (!cardName) { try { cardName = (await fetchCardData(r.id))?.data?.[0]?.name || null; } catch { cardName = null; } }
    if (!cardName) { reasons['no-name'] = (reasons['no-name'] || 0) + 1; continue; }
    const setNames = ix.setsByPrefix.get(prefixOf(r.set_code)) || [];
    const res = resolveProduct({ cardName, setNames }, ix);
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    if (res.idProduct) pending.push({ ...r, idProduct: res.idProduct });
  }
  const upd = db.prepare("UPDATE cards SET cm_product_id = ? WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?");
  db.transaction(() => { for (const p of pending) upd.run(p.idProduct, p.id, p.set_code, p.language, p.rarity); })();
  return { resolved: pending.length, reasons };
}

// Learned from real ids only (derived ones would reinforce their own mistakes).
function learnedFrom(db, ix) {
  const known = db.prepare(
    "SELECT rarity, cm_product_id AS idProduct FROM cards WHERE cm_product_id IS NOT NULL AND COALESCE(cm_product_derived, 0) = 0"
  ).all();
  return learnRanks(known, ix.versionIndex);
}

// Rarities YGOPRODeck lists for a passcode under one set prefix (api_cache-backed; [] when unknown).
async function printingRaritiesOf(id, prefix) {
  try {
    const sets = (await fetchCardData(id))?.data?.[0]?.card_sets || [];
    return sets.filter(s => prefixOf(s.set_code) === prefix).map(s => s.set_rarity);
  } catch { return []; }
}

// Step A2: printings Step A left ambiguous get the version that the same set's other cards of that
// rarity sit at (see deriveProduct), flagged cm_product_derived = 1. An id a real printing of another
// rarity already holds is never handed out a second time. `raritiesOf` is injected by tests.
async function deriveMissing(db, ix, raritiesOf = printingRaritiesOf) {
  if (!ix) return 0;
  const learned = learnedFrom(db, ix);
  const taken = new Map();
  for (const t of db.prepare("SELECT cm_product_id AS idProduct, rarity FROM cards WHERE cm_product_id IS NOT NULL").all()) {
    if (!taken.has(t.idProduct)) taken.set(t.idProduct, new Set());
    taken.get(t.idProduct).add(t.rarity);
  }
  const upd = db.prepare("UPDATE cards SET cm_product_id = ?, cm_product_derived = 1 WHERE id = ? AND set_code = ? AND language = ? AND rarity = ? AND cm_product_id IS NULL");
  const pending = [];
  for (const r of db.prepare(UNRESOLVED_SQL).all()) {
    if (!r.name) continue;
    const q = { cardName: r.name, setNames: ix.setsByPrefix.get(prefixOf(r.set_code)) || [], rarity: r.rarity };
    let res = deriveProduct(q, { ...ix, learned });
    if (res.reason === 'needs-printings') res = deriveProduct({ ...q, printingRarities: await raritiesOf(r.id, prefixOf(r.set_code)) }, { ...ix, learned });
    if (!res.idProduct) continue;
    const owners = taken.get(res.idProduct);
    if (owners && [...owners].some(rar => rar !== r.rarity)) continue;
    pending.push({ ...r, idProduct: res.idProduct });
  }
  let derived = 0;
  db.transaction(() => { for (const p of pending) derived += upd.run(p.idProduct, p.id, p.set_code, p.language, p.rarity).changes; })();
  return derived;
}

// Step B: price = trend for every resolved, non-manual printing present in the guide with a
// positive trend (Cardmarket uses trend: 0 for "no trend", not a real price). price_locked = 2
// means the user entered the price by hand (set-card-price) — the bulk refresh never overwrites it.
function applyPrices(db, guide) {
  const trendById = new Map();
  for (const g of guide) if (g && g.trend != null && g.trend > 0) trendById.set(Number(g.idProduct), Number(g.trend));
  const rows = db.prepare(
    "SELECT id, set_code, language, rarity, cm_product_id, cm_lang_factor FROM cards WHERE deleted = 0 AND cm_product_id IS NOT NULL AND COALESCE(price_locked, 0) != 2 AND language != 'KR'"
  ).all();
  // Only writes (and only counts as "priced") when the price actually changes, so an unchanged
  // day's refresh doesn't touch `updated_at` on every resolved row (which would trigger a full
  // Supabase push for the whole collection).
  const upd = db.prepare(
    "UPDATE cards SET price = ?, price_locked = 1, cm_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ? AND price IS NOT ?"
  );
  let priced = 0, skipped = 0, unchanged = 0;
  db.transaction(() => {
    for (const r of rows) {
      const trend = trendById.get(Number(r.cm_product_id));
      if (trend == null) { skipped++; continue; }
      const t = applyLangFactor(trend, r.cm_lang_factor); // KR: Trend x Sprachfaktor
      const info = upd.run(t, r.id, r.set_code, r.language, r.rarity, t);
      if (info.changes > 0) { priced++; recordPrice(db, r, t, 'cm_bulk'); } else unchanged++;
    }
  })();
  return { priced, skipped, unchanged };
}

// Entry point. `files` (tests only) injects { guide, singles, nonsingles, cardsets } or { error }.
async function runBulkRefresh(db, { userDataPath, force = false, files = null, raritiesOf } = {}) {
  let data;
  try {
    if (files && files.error) throw files.error;
    data = files || await loadAll(userDataPath, force);
  } catch (e) {
    console.error('[cardmarket-bulk] load failed:', e.message);
    return { error: 'download', message: e.message, resolved: 0, priced: 0, skipped: 0, unchanged: 0, sealedPriced: 0, unresolved: countUnresolved(db), reasons: {} };
  }
  const ix = buildIndexes(data);
  const a = await resolveMissing(db, ix);
  const derived = await deriveMissing(db, ix, raritiesOf);
  const b = applyPrices(db, data.guide);
  // Step C runs isolated: a failure here must not lose the A/B numbers already written, nor skip
  // the cm_bulk_last_run stamp (the bulk run would otherwise look overdue forever).
  let sealedPriced = 0;
  let sealedError = null;
  try {
    sealedPriced = applySealedPrices(db, data.guide); // Step C
  } catch (e) {
    console.error('[cm-bulk] sealed step failed:', e.message);
    sealedError = e.message;
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('cm_bulk_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString());
  const out = { resolved: a.resolved, derived, reasons: a.reasons, priced: b.priced, skipped: b.skipped, unchanged: b.unchanged, sealedPriced, unresolved: countUnresolved(db) };
  if (sealedError) out.sealed = { error: sealedError };
  console.log('[cardmarket-bulk]', JSON.stringify(out));
  return out;
}

function getBulkStatus(db) {
  const last = db.prepare("SELECT value FROM settings WHERE key = 'cm_bulk_last_run'").get();
  const c = db.prepare(
    "SELECT SUM(cm_product_id IS NOT NULL) AS r, SUM(cm_product_id IS NULL AND set_code != 'Unknown') AS u FROM cards WHERE deleted = 0 AND quantity > 0 AND language != 'KR'"
  ).get();
  return { lastRun: last ? last.value : null, resolvedCount: c.r || 0, unresolvedCount: c.u || 0 };
}

// Scraper helper: order cards so each set/rarity group gets its two real ids first, and after every
// hit derive (and price) the siblings that became derivable. Files come from the bulk cache; the
// parsed indexes are kept for an hour so the 10-minute poller doesn't re-parse 30 MB each tick.
let deriverCache = null;
async function makeDeriver(db, userDataPath) {
  if (!deriverCache || Date.now() - deriverCache.at > H) {
    const data = await loadAll(userDataPath, false);
    deriverCache = { at: Date.now(), guide: data.guide, ix: buildIndexes(data) };
  }
  const { guide, ix } = deriverCache;
  if (!ix) return null;
  return {
    async order(cards) {
      const learned = learnedFrom(db, ix);
      const keysById = new Map();
      for (const r of db.prepare(UNRESOLVED_SQL).all()) {
        if (!r.name) continue;
        const { groupKey } = deriveProduct({ cardName: r.name, setNames: ix.setsByPrefix.get(prefixOf(r.set_code)) || [], rarity: r.rarity }, { ...ix, learned });
        if (!groupKey) continue;
        // Deck-Sets lernen nichts aus Vorbildern -> diese Karten nicht vorziehen.
        const n = Number(groupKey.split('|')[1]);
        if (!versionsAreRarities(await printingRaritiesOf(r.id, prefixOf(r.set_code)), n)) continue;
        if (!keysById.has(String(r.id))) keysById.set(String(r.id), []);
        keysById.get(String(r.id)).push(groupKey);
      }
      // A group whose examples disagree can't be fixed by more scraping -> counts as satisfied.
      const startCount = (k) => { const m = learned.get(k); return !m ? 0 : m.size === 1 ? [...m.values()][0] : 2; };
      return orderForLearning(cards, c => keysById.get(String(c.id)) || [], startCount);
    },
    // idProduct einer Versionszeile ohne Bild-Adresse (siehe idFromVersionRow).
    idForRow(cardName, row) {
      return idFromVersionRow({ cardName, expansion: row.expansion, alt: row.alt }, ix);
    },
    async derive() {
      const n = await deriveMissing(db, ix);
      if (n > 0) applyPrices(db, guide);
      return n;
    },
  };
}

// Spec 2026-10-04 §3.2 — Zuordnung fuer den Katalog-Bau. Echte IDs aus der Sammlung (nicht abgeleitet)
// haben Vorrang. KR-Drucke bekommen nie eine Nummer (Cardmarket fuehrt kein Koreanisch).
// null, wenn die Cardmarket-Dateien oder YGOPRODecks Set-Liste fehlen -- der Katalog wird dann ohne `cm` gebaut.
async function makeCmLookup(db, userDataPath) {
  const data = await loadAll(userDataPath, false);
  const ix = buildIndexes(data);
  if (!ix) return null;
  const learned = learnedFrom(db, ix);
  const real = new Map();
  const rows = db.prepare(
    "SELECT name, set_code, rarity, cm_product_id FROM cards WHERE cm_product_id IS NOT NULL AND COALESCE(cm_product_derived, 0) = 0 AND language != 'KR'"
  ).all();
  for (const r of rows) real.set(`${prefixOf(r.set_code)}|${normName(r.name)}|${r.rarity}`, r.cm_product_id);
  return (nameEn, code, rarity, printingRarities) => {
    if (isKoreanCode(code)) return null;
    const prefix = prefixOf(code);
    return cmForPrinting({
      cardName: nameEn, setNames: ix.setsByPrefix.get(prefix) || [], rarity, printingRarities,
      realId: real.get(`${prefix}|${normName(nameEn)}|${rarity}`),
    }, { ...ix, learned });
  };
}

module.exports = { runBulkRefresh, getBulkStatus, makeDeriver, makeCmLookup };
