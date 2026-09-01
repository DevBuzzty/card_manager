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

// Ascending value rank for the "only scrape from rarity X upwards" filter. Substring-based so it
// covers every YGO rarity variant (20th/Extra/Pharaoh's Secret, Ghost/Gold, Duel Terminal, Mosaic,
// Parallel, …) without an exhaustive table. A rarity we can't classify returns 99 = "always
// include", so a weird/valuable printing is never silently skipped. Order = most-valuable first.
function rarityRank(r) {
  const s = normRarity(r); // letters only, lowercased
  if (!s) return 99;
  if (s.includes('quartercentury')) return 8;
  if (s.includes('prismatic') || s.includes('starlight') || s.includes('ghost') || s.includes('collector')) return 7;
  if (s.includes('ultimate') || s.includes('platinum')) return 6;
  if (s.includes('secret')) return 5;                  // Secret + 20th/Extra/Pharaoh's Secret
  if (s.includes('ultra') || s.includes('gold')) return 4;
  if (s.includes('super') || s.includes('parallel')) return 3;
  if (s.includes('common') || s.includes('shortprint') || s.includes('normal')) return 1;
  if (s.includes('rare')) return 2;                    // plain Rare (checked after the specific ones)
  return 99;                                           // unclassified -> include, never skip a valuable one
}

module.exports = { normRarity, normName, rarityKey, rarityRank, RARITY_SYNONYMS, matchRow };
