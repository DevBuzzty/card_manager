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
function expansionIdsFor(setNames, expansionIndex) {
  const expIds = new Set();
  for (const sn of setNames || []) {
    const clean = decodeEntities(sn);
    const ids = expansionIndex.get(normName(clean)) || expansionIndex.get(tokenKey(clean));
    if (ids) for (const id of ids) expIds.add(id);
  }
  return expIds;
}

function resolveProduct({ cardName, setNames }, { expansionIndex, singlesIndex }) {
  const expIds = expansionIdsFor(setNames, expansionIndex);
  if (expIds.size === 0) return { idProduct: null, reason: 'no-expansion' };
  const cands = (singlesIndex.get(normName(cardName)) || []).filter(p => expIds.has(p.idExpansion));
  if (cands.length === 0) return { idProduct: null, reason: 'no-candidate' };
  if (cands.length > 1) return { idProduct: null, reason: 'ambiguous' };
  return { idProduct: cands[0].idProduct, reason: 'resolved' };
}

// --- Abgeleitete Produkt-IDs (01.10.2026) ---
// Cardmarket legt die Versionen eines Sets seltenheitsweise in Bloecken an (alle Super Rares, dann alle
// Ultra Rares ...). Die k-te Version einer Karte (nach idProduct sortiert) ist darum im ganzen Set
// dieselbe Seltenheit -- vorausgesetzt, die Karte hat dort gleich viele Versionen. Gegenprobe an 188
// bekannten Drucken mit >= 2 Vorbildern: 185 richtig.

// normName(Karte)|idExpansion -> nach idProduct sortierte Versionen; pos: idProduct -> { exp, n, rank }.
function buildVersionIndex(singles) {
  const byKey = new Map();
  for (const p of singles || []) {
    const name = normName(p.name);
    if (!name || p.idExpansion == null) continue;
    const key = name + '|' + Number(p.idExpansion);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(Number(p.idProduct));
  }
  const pos = new Map();
  for (const [key, ids] of byKey) {
    ids.sort((a, b) => a - b);
    const exp = Number(key.slice(key.lastIndexOf('|') + 1));
    ids.forEach((id, rank) => pos.set(id, { exp, n: ids.length, rank }));
  }
  return { byKey, pos };
}

// known: [{ rarity, idProduct }] mit ECHTEN (nicht abgeleiteten) IDs -> 'exp|n|rarity' -> Map(rank -> Anzahl).
function learnRanks(known, versionIndex) {
  const learned = new Map();
  for (const k of known || []) {
    const p = versionIndex.pos.get(Number(k.idProduct));
    if (!p || p.n < 2) continue;
    const key = `${p.exp}|${p.n}|${k.rarity}`;
    if (!learned.has(key)) learned.set(key, new Map());
    const m = learned.get(key);
    m.set(p.rank, (m.get(p.rank) || 0) + 1);
  }
  return learned;
}

// Leitet die Version eines mehrdeutigen Drucks ab. Nur wenn die Karte in genau EINEM Set-Kandidaten
// mehrere Versionen hat und sich alle (>= minSamples) Vorbilder dieser Gruppe auf eine Position einig
// sind. groupKey benennt die Gruppe auch ohne Ergebnis (der Scraper sammelt damit gezielt Vorbilder).
// printingRarities = Seltenheiten, die YGOPRODeck fuer die Karte unter diesem Set-Kuerzel listet. Nur
// wenn das genau n VERSCHIEDENE sind, stehen die Versionen fuer Seltenheiten -- in Deck-Sets wie YGLD
// (Deck A/B/C) oder bei Neuauflagen ist eine Seltenheit mehrfach da, die Reihenfolge sagt dann nichts.
function deriveProduct({ cardName, setNames, rarity, printingRarities }, { expansionIndex, versionIndex, learned }, minSamples = 2) {
  const name = normName(cardName);
  const hits = [];
  for (const e of expansionIdsFor(setNames, expansionIndex)) {
    const ids = versionIndex.byKey.get(name + '|' + e);
    if (ids) hits.push({ e, ids });
  }
  if (hits.length !== 1 || hits[0].ids.length < 2) return { idProduct: null, groupKey: null, reason: 'no-group' };
  const { e, ids } = hits[0];
  const groupKey = `${e}|${ids.length}|${rarity}`;
  const m = learned.get(groupKey);
  if (!m) return { idProduct: null, groupKey, reason: 'no-model' };
  if (m.size !== 1) return { idProduct: null, groupKey, reason: 'conflict' };
  const [[rank, count]] = m;
  if (count < minSamples) return { idProduct: null, groupKey, reason: 'too-few' };
  if (printingRarities === undefined) return { idProduct: null, groupKey, reason: 'needs-printings' }; // Aufrufer holt sie nach
  return versionsAreRarities(printingRarities, ids.length)
    ? { idProduct: ids[rank], groupKey, reason: 'derived' }
    : { idProduct: null, groupKey: null, reason: 'not-by-rarity' };
}

function versionsAreRarities(printingRarities, n) {
  const rar = printingRarities || [];
  return rar.length === n && new Set(rar).size === n;
}

// Scraper-Reihenfolge: eine Gruppe braucht `need` echte IDs, danach sind ihre restlichen Karten
// ableitbar. Darum zuerst die Karten, die einer Gruppe noch ein Vorbild liefern (und Karten ohne
// Gruppe, die ohnehin gescrapt werden muessen); der Rest nach hinten. Sonst bleibt die Reihenfolge.
function orderForLearning(items, keysOf, startCount = () => 0, need = 2) {
  const seen = new Map();
  const ranked = items.map((it, i) => {
    const keys = keysOf(it);
    let later = false;
    if (keys.length) {
      const counts = keys.map(k => (seen.has(k) ? seen.get(k) : startCount(k)));
      later = Math.min(...counts) >= need;
      keys.forEach((k, j) => seen.set(k, counts[j] + 1));
    }
    return { it, i, later };
  });
  return ranked.sort((a, b) => (a.later - b.later) || (a.i - b.i)).map(x => x.it);
}

// "https://product-images.s3.cardmarket.com/5/LOB/102800/102800.jpg" -> 102800
function idProductFromImageUrl(url) {
  const m = String(url || '').match(/\/(\d+)\/\1\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i);
  return m ? Number(m[1]) : null;
}

module.exports = {
  expansionNameFromProduct, buildExpansionIndex, buildSinglesIndex, resolveProduct, idProductFromImageUrl,
  expansionNameVariants, decodeEntities, tokenKey,
  buildVersionIndex, learnRanks, deriveProduct, versionsAreRarities, orderForLearning,
};
