// desktop/electron/cardmarket-bulk-parse.cjs
// Pure helpers for resolving a printing's Cardmarket idProduct from the free download files
// (products_singles_3.json + products_nonsingles_3.json). No I/O, no Electron — unit-tested.
const { normName } = require('./cardmarket-parse.cjs');

// Cardmarket names sealed products "<Expansion> Booster", "<Expansion> Booster Box",
// "<Expansion> Box Set", "<Expansion> Card Pack", "<Expansion> Case (12 Booster Boxes)",
// "<Expansion> (2021 Reprint)" … — strip the product-type tail to recover the expansion name.
const SUFFIX_RE = /\s+(Booster Box|Booster|Box Set|Card Pack|Special Edition|Tin|Pack|Set|Display|Bundle|Deck|Mini Box\b.*|Case\b.*|\(\d{4} Reprint\))$/i;

// Every name a sealed product may stand for: the raw name and each successive suffix strip
// ("X Mega Pack Booster" -> "X Mega Pack" -> "X Mega"). Indexing every step keeps the right
// intermediate form (here "X Mega Pack" is the YGOPRODeck set name) without knowing where to stop.
function expansionNameVariants(name) {
  const out = [];
  let s = String(name || '').trim();
  for (let i = 0; i < 4 && s; i++) {
    const clean = s.replace(/[:\-–\s]+$/, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
    const t = s.replace(SUFFIX_RE, '').trim();
    if (t === s) break;
    s = t;
  }
  return out;
}

function expansionNameFromProduct(name) {
  const v = expansionNameVariants(name);
  return v.length ? v[v.length - 1] : '';
}

// YGOPRODeck set names carry HTML entities ("Legendary 5D&apos;s Decks").
function decodeEntities(s) {
  return String(s || '').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// Order-insensitive key so "Synchron Extreme Structure Deck" == "Structure Deck: Synchron Extreme".
// Empty for single-token names (the exact normName key already covers those). Contains '|', so it
// can never collide with a normName key in the same Map.
function tokenKey(s) {
  const toks = decodeEntities(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort();
  return toks.length > 1 ? toks.join('|') : '';
}

// normName(expansion name) -> Set<idExpansion>. Several product variants of one expansion collapse
// onto the same key; a key pointing at >1 expansions is a genuine ambiguity handled by the caller.
function buildExpansionIndex(nonsingles) {
  const idx = new Map();
  const add = (key, id) => {
    if (!key) return;
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key).add(id);
  };
  for (const p of nonsingles || []) {
    if (p.idExpansion == null) continue;
    const id = Number(p.idExpansion);
    for (const v of expansionNameVariants(p.name)) { add(normName(v), id); add(tokenKey(v), id); }
  }
  return idx;
}

// normName(card name) -> [{ idProduct, idExpansion }]
function buildSinglesIndex(singles) {
  const idx = new Map();
  for (const p of singles || []) {
    const key = normName(p.name);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ idProduct: Number(p.idProduct), idExpansion: Number(p.idExpansion) });
  }
  return idx;
}

// Resolve one printing. `setNames` = every YGOPRODeck set_name sharing the printing's set-code
// prefix (e.g. LOB -> original + 25th Anniversary Edition). Exactly one product for the card in
// the union of those expansions -> resolved. Anything else -> null, never a guess.
function resolveProduct({ cardName, setNames }, { expansionIndex, singlesIndex }) {
  const expIds = new Set();
  for (const sn of setNames || []) {
    const clean = decodeEntities(sn);
    const ids = expansionIndex.get(normName(clean)) || expansionIndex.get(tokenKey(clean));
    if (ids) for (const id of ids) expIds.add(id);
  }
  if (expIds.size === 0) return { idProduct: null, reason: 'no-expansion' };
  const cands = (singlesIndex.get(normName(cardName)) || []).filter(p => expIds.has(p.idExpansion));
  if (cands.length === 0) return { idProduct: null, reason: 'no-candidate' };
  if (cands.length > 1) return { idProduct: null, reason: 'ambiguous' };
  return { idProduct: cands[0].idProduct, reason: 'resolved' };
}

// "https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg" -> 102800
function idProductFromImageUrl(url) {
  const m = String(url || '').match(/\/(\d+)\/\1\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i);
  return m ? Number(m[1]) : null;
}

module.exports = {
  expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl,
  expansionNameVariants, decodeEntities, tokenKey,
};
