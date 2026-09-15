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

// Spec G4 §4 — gemeinsame Zeilenauswahl fuer Basis- und 1st-Ed-Durchgang (wortgleich aus runCardmarketScrape
// gezogen). Primaer Set-Code-Praefix <-> Cardmarket-Symbol ("25LP-DE085" -> "25LP"); eine Zeile im Set ist
// eindeutig (Cardmarket laesst dann die Rarity weg); mehrere -> Rarity, bei Gleichstand die guenstigste.
// Sonst matchRow ueber den Set-Namen; lookupSetName (async) wird NUR dann gerufen.
async function selectVersionRow(rows, printing, lookupSetName) {
  const list = rows || [];
  const codePrefix = String(printing.set_code || '').split('-')[0];
  const wantRar = rarityKey(printing.rarity), wantCode = normName(codePrefix);
  const codeRows = list.filter(r => r.code && r.trend != null && normName(r.code) === wantCode);
  let hit = null;
  if (codeRows.length === 1) {
    hit = codeRows[0];
  } else if (codeRows.length > 1) {
    const rarHits = codeRows.filter(r => rarityKey(r.rarity) === wantRar);
    if (rarHits.length) hit = rarHits.reduce((a, b) => (b.trend < a.trend ? b : a));
  }
  if (!hit) {
    const setName = lookupSetName ? await lookupSetName() : null;
    hit = setName ? matchRow(list, setName, printing.rarity) : null;
  }
  return hit;
}

const CM_ORIGIN = 'https://www.cardmarket.com';

// Produkt-Link einer Versionszeile -> absolute Produkt-URL ohne Query; nur Singles auf cardmarket.com.
function productUrl(href) {
  if (!href) return null;
  let u;
  try { u = new URL(href, CM_ORIGIN); } catch { return null; }
  if (u.origin !== CM_ORIGIN || !u.pathname.includes('/Products/Singles/')) return null;
  return `${u.origin}${u.pathname}`;
}

const firstEdUrl = (url) => `${url}?isFirstEd=Y`;

// "58 €" / "58,00 €" / "1.234 €" / "1.234,56 €" -> Zahl; Cent-Teil optional (asymmetrisches Risiko: fehlt er
// nur auf der gefilterten Seite, wuerde sonst der Faktor NULL geschrieben); alles andere -> null.
function parseEuro(text) {
  const m = String(text || '').replace(/\s/g, '').match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?/);
  return m ? Number(`${m[1].replace(/\./g, '')}${m[2] ? '.' + m[2] : ''}`) : null;
}

// Ab-Preis aus den dt/dd-Paaren des Infokastens (.info-list-container); Label "From" (en) oder "Ab" (de).
function parseFromPrice(pairs) {
  for (const p of pairs || []) {
    if (p && /^(from|ab):?$/i.test(String(p.label || '').trim())) return parseEuro(p.value);
  }
  return null;
}

// Spec G4 §3: factor = max(1, round4(fromFirst / fromAll)). fromAll fehlt/0 -> nichts schreiben;
// fromFirst fehlt/0 -> Faktor NULL schreiben (kein Angebot mit Filter).
function firstEdFactor(fromAll, fromFirst) {
  if (!(Number(fromAll) > 0)) return { write: false, factor: null };
  if (!(Number(fromFirst) > 0)) return { write: true, factor: null };
  return { write: true, factor: Math.max(1, Math.round((Number(fromFirst) / Number(fromAll)) * 10000) / 10000) };
}

module.exports = { normRarity, normName, rarityKey, rarityRank, RARITY_SYNONYMS, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor };
