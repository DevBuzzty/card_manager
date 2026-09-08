// Confusion-aware fuzzy matching of OCR'd set-code candidates against a card's
// known printings. OCR is noisy, but a card's true set list is small and known,
// so we recover the correct printing by matching candidates against ground truth.

const CONFUSION_PAIRS = [
  ['O', '0'], ['I', '1'], ['S', '5'], ['B', '8'], ['Z', '2'], ['D', 'O'],
];
const CONFUSION = new Set(CONFUSION_PAIRS.flatMap(([a, b]) => [a + b, b + a]));

const FUZZY_THRESHOLD = 1.5;

export function normalize(code) {
  return (code || '').toString().toUpperCase().replace(/\s+/g, '');
}

// 0 identical, 0.5 for a known OCR confusion, 1 otherwise.
function subCost(a, b) {
  if (a === b) return 0;
  return CONFUSION.has(a + b) ? 0.5 : 1;
}

// Levenshtein with weighted substitutions.
export function confusionDistance(a, b) {
  a = normalize(a); b = normalize(b);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost(a[i - 1], b[j - 1])
      );
    }
  }
  return dp[m][n];
}

// Match candidate codes against `sets` (each with `.set_code`).
export function matchCandidates(candidates, sets) {
  const cands = (candidates || []).map(normalize).filter(Boolean);
  if (!sets || sets.length === 0 || cands.length === 0) {
    return { set: null, score: Infinity, confidence: 'none' };
  }
  // Exact match wins outright.
  for (const c of cands) {
    const hit = sets.find(s => normalize(s.set_code) === c);
    if (hit) return { set: hit, score: 0, confidence: 'exact' };
  }
  // Otherwise smallest weighted distance across all candidate x set pairs.
  let best = null, bestScore = Infinity;
  for (const s of sets) {
    for (const c of cands) {
      const d = confusionDistance(c, s.set_code);
      if (d < bestScore) { bestScore = d; best = s; }
    }
  }
  if (best && bestScore <= FUZZY_THRESHOLD) {
    return { set: best, score: bestScore, confidence: 'fuzzy' };
  }
  return { set: null, score: bestScore, confidence: 'none' };
}

// Spec D3 Task 8: preselects a printing from what the PHONE already resolved (setCode/rarity/
// language, sent alongside the scan) instead of matching OCR candidates against `printings` a
// second time here -- the phone saw the card's own band text through ScanScreen/SetCodeMatch.kt,
// this app never does, so its conclusion is used as-is rather than blended with a fresh local
// guess. Looks the phone's printing up in `printings` first so it carries a real price/isYugipedia
// flag; falls back to a printing BUILT from the phone's own fields (price 0, the same shape
// SetCodeMatch.kt's own "composed" case produces) when `printings` hasn't reached that printing's
// language list yet (e.g. the DE/JP fetch is still in flight). `null` when the phone itself found
// no match (`setCode` absent -- its Ampel was RED), the one case with nothing to preselect.
export function phoneSelectedSet(setCode, rarity, language, printings) {
  if (!setCode) return null;
  const hit = (printings || []).find(p =>
    normalize(p.set_code) === normalize(setCode) &&
    (!rarity || normalize(p.set_rarity) === normalize(rarity)) &&
    (!language || normalize(p.language) === normalize(language))
  );
  if (hit) return hit;
  return { set_code: setCode, set_rarity: rarity || 'Unknown', set_price: 0, language: language || 'DE' };
}

// Maps the phone's traffic light (green/yellow/red) onto the 'exact'/'fuzzy'/'none' vocabulary
// matchCandidates() already returns above, so a phone-resolved card drives the same "Erkannt"/
// "Prüfen?" badges and the "Erkannte übernehmen" bulk button in StagingArea as a locally-matched
// one -- the traffic-light dot + reason shown alongside it is the separate, new display the
// phone's Ampel actually needs.
export function mapPhoneConfidence(light) {
  if (light === 'green') return 'exact';
  if (light === 'yellow') return 'fuzzy';
  return 'none';
}
