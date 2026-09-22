// supabase/functions/_shared/listing-text.ts
// Spec H3b §5.2/§10 -- Deno-ZWILLING (Teilmenge) von desktop/electron/listing-text.cjs: groupItems, truncateTitle,
// listingTitle, listingDescription, pieceCents, dazu euroCentsText aus desktop/electron/sales-math.cjs.
// Weitere Fassungen: desktop/src/utils/listingText.js, android .../ml/ListingText.kt. Gemeinsame Fixture:
// docs/fixtures/listings/listings.json (titles, descriptions, pieceCents). Wer eine Fassung aendert, aendert alle.
// Laengen in UTF-16-Codeeinheiten, Vergleiche per Codeeinheiten (kein localeCompare).

export type LineItem = {
  copy_id: string; card_id: string; name?: string | null; set_code: string; language: string; rarity: string;
  edition: string; condition: string; image_url?: string | null;
};
export type Group = {
  card_id: string; name: string | null; set_code: string; language: string; rarity: string; edition: string;
  condition: string; image_url: string | null; count: number; copy_ids: string[];
};

export const TITLE_MAX = 65;
export const LANGUAGE_NAMES: Record<string, string> = {
  DE: "Deutsch", EN: "Englisch", FR: "Französisch", IT: "Italienisch", SP: "Spanisch", PT: "Portugiesisch", JP: "Japanisch",
};
const TITLE_EDITION: Record<string, string> = { first: "1. Auflage", limited: "Limitiert" };
const LINE_EDITION: Record<string, string> = { first: "1. Auflage", unlimited: "Unlimitiert", limited: "Limitiert" };
const EDITION_ORDER = ["first", "unlimited", "limited", "unknown"];
const CONDITION_ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
const DISCLAIMER = "Privatverkauf, keine Garantie oder Rücknahme.";
const MINUS = "−";

const known = (v: string | null | undefined) => v != null && v !== "" && v !== "Unknown";
const nameOf = (g: { name?: string | null; card_id: string }) => (g.name != null && g.name !== "" ? g.name : String(g.card_id));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const foldName = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

export function euroCentsText(c: number): string {
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ".");
  const txt = `${euros},${String(abs % 100).padStart(2, "0")} €`;
  return c < 0 ? MINUS + txt : txt;
}

export function groupItems(items: LineItem[]): Group[] {
  const m = new Map<string, Group>();
  for (const it of items || []) {
    const k = [String(it.card_id), it.set_code, it.language, it.rarity, it.edition, it.condition].join("|");
    const g = m.get(k);
    if (g) { g.count += 1; g.copy_ids.push(it.copy_id); continue; }
    m.set(k, {
      card_id: String(it.card_id), name: it.name ?? null, set_code: it.set_code, language: it.language, rarity: it.rarity,
      edition: it.edition, condition: it.condition, image_url: it.image_url ?? null, count: 1, copy_ids: [it.copy_id],
    });
  }
  const out = [...m.values()];
  for (const g of out) g.copy_ids.sort(cmp);
  return out.sort((a, b) => cmp(foldName(nameOf(a)), foldName(nameOf(b))) || cmp(a.set_code, b.set_code)
    || cmp(a.rarity, b.rarity) || cmp(a.language, b.language)
    || EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
    || CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition) || cmp(a.card_id, b.card_id));
}

export function truncateTitle(text: string, ellipsis: boolean): string {
  if (text.length <= TITLE_MAX) return text;
  const room = ellipsis ? TITLE_MAX - 1 : TITLE_MAX;
  const cut = text.lastIndexOf(" ", room);
  const head = (cut > 0 ? text.slice(0, cut) : text.slice(0, room)).replace(/[ ,–]+$/, "");
  return ellipsis ? `${head}…` : head;
}

function titleParts(g: Group): string {
  return ["Yu-Gi-Oh!", nameOf(g), known(g.set_code) ? g.set_code : null, known(g.rarity) ? g.rarity : null,
    TITLE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null, LANGUAGE_NAMES[g.language] ?? null]
    .filter((p) => p != null).join(" ");
}

export function listingTitle(items: LineItem[]): string {
  const groups = groupItems(items);
  if (groups.length === 0) return "";
  if (groups.length === 1) {
    const g = groups[0];
    return truncateTitle(g.count > 1 ? `${g.count}× ${titleParts(g)}` : titleParts(g), false);
  }
  const n = groups.reduce((a, g) => a + g.count, 0);
  const names: string[] = [];
  for (const g of groups) if (!names.includes(nameOf(g))) names.push(nameOf(g));
  return truncateTitle(`Yu-Gi-Oh! Konvolut ${n} Karten – ${names.join(", ")}`, true);
}

export function listingDescription(items: LineItem[], priceCents: number | null): string {
  const lines = groupItems(items).map((g) => [`${g.count}× ${nameOf(g)}`, known(g.set_code) ? g.set_code : null,
    known(g.rarity) ? g.rarity : null, LINE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null]
    .filter((p) => p != null).join(" – "));
  return [...lines, "", `Preis: ${priceCents == null ? "–" : euroCentsText(priceCents)}`, "", DISCLAIMER].join("\n");
}

export function pieceCents(totalCents: number, quantity: number): number {
  return Math.round(totalCents / quantity);
}
