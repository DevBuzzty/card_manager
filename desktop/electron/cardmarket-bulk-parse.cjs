// desktop/electron/cardmarket-bulk-parse.cjs
// Pure helpers for resolving a printing's Cardmarket idProduct from the free download files
// (products_singles_3.json + products_nonsingles_3.json). No I/O, no Electron — unit-tested.
const { normName } = require('./cardmarket-parse.cjs');

// Cardmarket names sealed products "<Expansion> Booster", "<Expansion> Booster Box",
// "<Expansion> Case (12 Booster Boxes)", "<Expansion> Mini Box (5 Boosters)", … — strip the
// product-type tail to recover the expansion name. Structure/Starter Deck products carry the bare
// expansion name and pass through unchanged.
const SUFFIX_RE = /\s+(Booster Box|Booster|Special Edition|Tin|Pack|Set|Display|Bundle|Deck|Mini Box\b.*|Case\b.*)$/i;

function expansionNameFromProduct(name) {
  let s = String(name || '').trim();
  for (let i = 0; i < 3; i++) {            // "X Booster Box" -> "X Booster" -> "X"
    const t = s.replace(SUFFIX_RE, '').trim();
    if (t === s) break;
    s = t;
  }
  return s.replace(/[:\-–\s]+$/, '').trim();
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
    add(normName(expansionNameFromProduct(p.name)), id);
    add(normName(p.name), id); // raw name too: set names that legitimately end in "Set"/"Pack" ("2-Player Starter Set") still match
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
    const ids = expansionIndex.get(normName(sn));
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

module.exports = { expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl };
