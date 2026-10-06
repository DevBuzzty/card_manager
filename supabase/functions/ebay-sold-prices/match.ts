// supabase/functions/ebay-sold-prices/match.ts
// eBay „zuletzt verkauft" §4 -- gehört ein verkaufter Artikel genau zu diesem Druck? Reine Funktion, am Messkorb
// (fixtures/titles.json, Messung 05.10.2026) geprüft. Wortlisten nur mit neuem Korb-Fall ändern.
export type Printing = { card_id: string; set_code: string; language: string; rarity: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "MAMO-DE020" -> MAMO, Trenner (- / Leerzeichen / nichts, auch " - "), DE020; links und rechts kein Buchstabe/keine Ziffer.
function codePattern(setCode: string): RegExp {
  const i = setCode.indexOf("-");
  const head = i < 0 ? setCode : setCode.slice(0, i), tail = i < 0 ? "" : setCode.slice(i + 1);
  return new RegExp(`(^|[^A-Za-z0-9])${esc(head)}\\s*-?\\s*${esc(tail)}($|[^A-Za-z0-9])`, "i");
}

const normRarity = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
// Reihenfolge egal; "secretrare" wird gestrichen, wenn eine speziellere Secret-Variante erkannt ist.
// Bindestrich-/Leerzeichen-tolerant, auch Kurzformen (SCR, QCSR, UR) und bare "Secret"/"Ultra"/"Super".
const RARITIES: [string, RegExp][] = [
  ["quartercenturysecretrare", /quarter[\s-]*century|\bqcs?c?r\b|\bqc[\s-]*secret/i],
  ["prismaticsecretrare", /prismatic/i],
  ["platinumsecretrare", /platinum[\s-]*secret/i],
  ["starlightrare", /starlight/i],
  ["ghostrare", /\bghost\b/i],
  ["collectorsrare", /collector'?s[\s-]*rare/i],
  ["ultimaterare", /\bultimate\b/i],
  ["goldrare", /\bgold[\s-]*rare/i],
  ["secretrare", /\bsecret\b|\bscr\b/i],
  ["ultrarare", /\bultra\b|\bur\b/i],
  ["superrare", /\bsuper\b/i],
  ["common", /\bcommon\b/i],
];
const SPECIFIC_SECRET = new Set(["quartercenturysecretrare", "prismaticsecretrare", "platinumsecretrare"]);

function mentionedRarities(title: string): Set<string> {
  const m = new Set(RARITIES.filter(([, re]) => re.test(title)).map(([k]) => k));
  if ([...m].some((k) => SPECIFIC_SECRET.has(k))) m.delete("secretrare");
  return m;
}

const EXCLUDE = /\b(psa|bgs|cgc|pgs|aog|gsg|beckett|graded|gegradet|lot|konvolut|sammlung|sammelaufl(ö|oe)sung|restposten|bundle|playset|set|proxy|orica|replica|fan\s*made|custom|altered|signed|signiert|misprint|fehldruck)\b|\b([2-9]|\d{2,})\s*x\b|\bx\s*([2-9]|\d{2,})\b/i;
const GRADED_CONDITION_IDS = new Set(["2750"]); // gemessen: eBay-Zustand „Graded"
const FIRST = /\b1\s*\.?\s*aufl|\b1\s*\.\s*a\b|\b1\s*st\b|\b1\s*ed\b|\berstauflage\b|\bfirst\b|\b1\.(?=\s|$|,)/i;
const NOT_FIRST = /\bnon[\s-]*(1st|first)\b/i;
// Beliebiger Set-Code im Titel; mehrere verschiedene = Sammelangebot.
const ANY_CODE = /\b[A-Z0-9]{2,5}-[A-Z]{0,2}\d{3}\b/gi;

export function matchSale(title: string, conditionId: string | null, p: Printing): { ok: boolean; first: boolean } {
  const t = String(title || "");
  const first = FIRST.test(t) && !NOT_FIRST.test(t);
  if (!codePattern(p.set_code).test(t)) return { ok: false, first };
  const codes = new Set((t.match(ANY_CODE) ?? []).map((x) => x.toUpperCase()));
  if (codes.size > 1) return { ok: false, first };
  if (EXCLUDE.test(t) || (conditionId != null && GRADED_CONDITION_IDS.has(conditionId))) return { ok: false, first };
  const m = mentionedRarities(t);
  if (m.size > 0 && !m.has(normRarity(p.rarity))) return { ok: false, first };
  return { ok: true, first };
}
