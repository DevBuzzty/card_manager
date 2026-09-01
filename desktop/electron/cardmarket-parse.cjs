// desktop/electron/cardmarket-parse.cjs
// Pure helpers for matching a scraped Cardmarket version row to a collection printing.
// No browser / HTML here — the DOM extraction lives in the scraper (executeJavaScript).

function normRarity(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Cardmarket rarity label (normalised) -> our canonical rarity (normalised). Extend as needed.
const RARITY_SYNONYMS = {
  common: 'common',
  rare: 'rare',
  superrare: 'superrare',
  ultrarare: 'ultrarare',
  secretrare: 'secretrare',
  ultimaterare: 'ultimaterare',
  ghostrare: 'ghostrare',
  collectorsrare: 'collectorsrare',
  starlightrare: 'starlightrare',
  quartercenturysecretrare: 'quartercenturysecretrare',
  prismaticsecretrare: 'prismaticsecretrare',
  goldrare: 'goldrare',
  platinumsecretrare: 'platinumsecretrare',
};

function rarityKey(s) {
  const n = normRarity(s);
  return RARITY_SYNONYMS[n] || n;
}

// Best confident match, or null. Requires the rarity to match exactly (after synonym mapping)
// and the expansion to match fuzzily (one contains the other after normalisation).
function matchRow(rows, setName, rarity) {
  const wantRar = rarityKey(rarity);
  const wantExp = normName(setName);
  if (!wantExp) return null;
  const candidates = (rows || []).filter(r => rarityKey(r.rarity) === wantRar);
  const hit = candidates.filter(r => {
    const e = normName(r.expansion);
    return e === wantExp || e.includes(wantExp) || wantExp.includes(e);
  });
  return hit.length === 1 ? hit[0] : null;
}

// Ascending value rank, for the "only scrape from rarity X upwards" filter. Unknown -> 1 (common).
const RARITY_RANK = {
  common: 1, shortprint: 1, rare: 2, superrare: 3, ultrarare: 4, secretrare: 5,
  ultimaterare: 6, ghostrare: 6, holographicrare: 6, goldrare: 4, platinumsecretrare: 7,
  collectorsrare: 7, starlightrare: 8, prismaticsecretrare: 8, quartercenturysecretrare: 9,
};
function rarityRank(r) { return RARITY_RANK[rarityKey(r)] || 1; }

module.exports = { normRarity, normName, rarityKey, rarityRank, RARITY_SYNONYMS, matchRow };
