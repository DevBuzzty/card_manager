// Spec H1 §4/§5 -- Duplikate (Überschuss über keep_per_card je Haupt-Passcode, Vorschlag), Verkaufsliste und die Texte dazu.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/Duplicates.kt. Beide laufen gegen
// docs/fixtures/duplicates/duplicates.json. Wer eine Seite aendert, aendert beide.
// Ein Exemplar ist eine Zeile wie main.cjs 'list-sale-copies' (copies.cjs#listSaleCopies): Exemplarfelder plus
// name, image_url, price, price_first_ed des Printings. Der Wert je Exemplar ist die Wertanzeige-Formel
// unitPrice (1.-Auflage-Preis bei edition = 'first', G4) x Zustandsfaktor.
import { unitPrice, conditionFactor, EDITION_LABELS } from './valuation.js';
import { parseTags } from './tags.js';
import { fmtNum } from './format.js';

export const KEEP_DEFAULT = 3;
export const LOADING = '…';

// Schlechtester Zustand zuerst; ein unbekannter Zustand ordnet wie NM.
const CONDITION_RANK = ['PO', 'PL', 'LP', 'GD', 'EX', 'NM', 'MT'];
const KEEP_RE = /^\s*([0-9]{1,2})\s*$/;
const BLANK_RE = /^\s*$/;

const round2 = (v) => Math.round(v * 100) / 100;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const flag = (v) => (v ? 1 : 0);
const rank = (condition) => {
  const i = CONDITION_RANK.indexOf(condition);
  return i < 0 ? CONDITION_RANK.indexOf('NM') : i;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WHOLE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// Einstellung keep_per_card: ganze Zahl 1–99 (Text oder Zahl), alles andere -> 3.
export function keepPerCard(raw) {
  const m = KEEP_RE.exec(raw == null ? '' : String(raw));
  if (!m) return KEEP_DEFAULT;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : KEEP_DEFAULT;
}

// Standort (container_id), Tags oder Notiz gesetzt; leere Werte zaehlen wie nicht gesetzt.
export function hasPlace(copy) {
  const container = copy.container_id;
  if (container != null && container !== '') return true;
  if (parseTags(copy.tags).length > 0) return true;
  return copy.note != null && !BLANK_RE.test(copy.note);
}

// Wert eines Exemplars (ungerundet); ohne Preis 0.
export const unitValue = (copy) => unitPrice(copy, copy) * conditionFactor(copy.condition);

// Stabile Vorschlags-Reihenfolge (Spec H1 §4, Kriterien 1–6); zuletzt copy_id, damit beide Geraete gleich ordnen.
function proposalOrder(a, b) {
  return (flag(b.for_sale) - flag(a.for_sale))
    || (flag(hasPlace(a)) - flag(hasPlace(b)))
    || (flag(a.edition === 'first') - flag(b.edition === 'first'))
    || (rank(a.condition) - rank(b.condition))
    || (unitPrice(a, a) - unitPrice(b, b))
    || cmpStr(String(b.created_at ?? ''), String(a.created_at ?? ''))
    || cmpStr(String(a.copy_id), String(b.copy_id));
}

// copies: lebende Exemplare; keep: keep_per_card (roh oder Zahl); mainIdOf(passcode) -> Haupt-Passcode (null = ohne Katalog).
// -> [{ main_id, count, surplus, copy_ids (Vorschlag in Sortierreihenfolge), value }], nur Karten mit Überschuss,
//    sortiert nach Überschuss, dann Wert des Vorschlags (beide absteigend), dann Haupt-Passcode.
export function duplicates(copies, keep, mainIdOf) {
  const k = keepPerCard(keep);
  const groups = new Map();
  for (const c of copies || []) {
    if (!c || c.deleted) continue;
    const stored = String(c.card_id);
    const mapped = mainIdOf ? mainIdOf(stored) : null;
    const id = mapped == null || mapped === '' ? stored : String(mapped);
    const list = groups.get(id);
    if (list) list.push(c); else groups.set(id, [c]);
  }
  const out = [];
  for (const [id, list] of groups) {
    const surplus = Math.max(0, list.length - k);
    if (surplus === 0) continue;
    const pick = [...list].sort(proposalOrder).slice(0, surplus);
    out.push({
      main_id: id, count: list.length, surplus,
      copy_ids: pick.map((c) => String(c.copy_id)),
      value: round2(pick.reduce((s, c) => s + unitValue(c), 0)),
    });
  }
  return out.sort((a, b) => (b.surplus - a.surplus) || (b.value - a.value) || cmpStr(a.main_id, b.main_id));
}

export function duplicatesSummary(list) {
  const entries = list || [];
  return {
    cards: entries.length,
    copies: entries.reduce((s, e) => s + e.surplus, 0),
    value: round2(entries.reduce((s, e) => s + e.value, 0)),
  };
}

// Lebende Exemplare mit for_sale.
export function forSaleSummary(copies) {
  const marked = (copies || []).filter((c) => c && !c.deleted && c.for_sale);
  return { copies: marked.length, value: round2(marked.reduce((s, c) => s + unitValue(c), 0)) };
}

// Verkaufsliste nach Printing: nur Printings mit markierten lebenden Exemplaren, sortiert nach Name, Set-Code, Sprache,
// Seltenheit (Codeeinheiten wie der Kotlin-Zwilling), Exemplare nach created_at, dann copy_id.
// -> [{ card_id, set_code, language, rarity, name, copy_ids }]
export function forSaleGroups(copies) {
  const groups = new Map();
  for (const c of copies || []) {
    if (!c || c.deleted || !c.for_sale) continue;
    const key = JSON.stringify([String(c.card_id), c.set_code, c.language, c.rarity]);
    const g = groups.get(key);
    if (g) g.copies.push(c);
    else groups.set(key, { card_id: String(c.card_id), set_code: c.set_code, language: c.language, rarity: c.rarity, name: c.name ?? null, copies: [c] });
  }
  const byCreated = (a, b) => cmpStr(String(a.created_at ?? ''), String(b.created_at ?? '')) || cmpStr(String(a.copy_id), String(b.copy_id));
  return [...groups.values()]
    .map(({ copies: list, ...g }) => ({ ...g, copy_ids: [...list].sort(byCreated).map((c) => String(c.copy_id)) }))
    .sort((a, b) => cmpStr(a.name ?? '', b.name ?? '') || cmpStr(a.set_code, b.set_code)
      || cmpStr(a.language, b.language) || cmpStr(a.rarity, b.rarity) || cmpStr(a.card_id, b.card_id));
}

export const euroCents = (v) => `${fmtNum(round2(v))} €`;
export const euroWhole = (v) => `${WHOLE.format(Math.round(v))} €`;

// "14 Karten · 31 Exemplare über Playset · ca. 62 €"
export const headerText = (s) =>
  `${plural(s.cards, 'Karte', 'Karten')} · ${plural(s.copies, 'Exemplar', 'Exemplare')} über Playset · ca. ${euroWhole(s.value)}`;
// "31 Exemplare von 14 Karten markieren?"
export const confirmAllText = (s) => `${plural(s.copies, 'Exemplar', 'Exemplare')} von ${plural(s.cards, 'Karte', 'Karten')} markieren?`;
// "5 Exemplare · 2 über Playset"
export const rowCountText = (e) => `${plural(e.count, 'Exemplar', 'Exemplare')} · ${e.surplus} über Playset`;

// Vorschlag in Worten, je Set-Code/Seltenheit/Zustand/Edition gezaehlt, in Vorschlagsreihenfolge:
// ["2× LOB-DE001 Common · NM · Unlimited"]. copiesById: Map copy_id -> Exemplar.
export function proposalTexts(entry, copiesById) {
  const groups = new Map();
  for (const id of entry.copy_ids) {
    const c = copiesById.get(id);
    if (!c) continue;
    const key = JSON.stringify([c.set_code, c.rarity, c.condition, c.edition]);
    const g = groups.get(key);
    if (g) g.n += 1; else groups.set(key, { n: 1, c });
  }
  return [...groups.values()].map(({ n, c }) =>
    `${n}× ${c.set_code} ${c.rarity} · ${c.condition} · ${EDITION_LABELS[c.edition] ?? c.edition}`);
}

// "23 Exemplare · 84,30 €"
export const forSaleHeaderText = (s) => `${plural(s.copies, 'Exemplar', 'Exemplare')} · ${euroCents(s.value)}`;
// "Zum Verkauf: 23 Exemplare · 84 €"
export const startSaleText = (s) => `Zum Verkauf: ${plural(s.copies, 'Exemplar', 'Exemplare')} · ${euroWhole(s.value)}`;
// "Duplikate: 14 Karten"
export const startDuplicatesText = (s) => `Duplikate: ${plural(s.cards, 'Karte', 'Karten')}`;
// "davon zum Verkauf: 84 €"
export const saleShareText = (s) => `davon zum Verkauf: ${euroWhole(s.value)}`;
// "(2 zum Verkauf)" an der Sammlungszeile; ohne markierte Exemplare null.
export const forSaleSuffix = (n) => (n > 0 ? `(${n} zum Verkauf)` : null);
// Wert je Exemplar in der Verkaufsliste; ohne Preis "—".
export const copyValueText = (c) => (unitPrice(c, c) > 0 ? euroCents(unitValue(c)) : '—');

// Spec H1 §5.4 -- Zeilen-Schalter "Auf die Verkaufsliste". forSaleIds: Set der markierten copy_ids.
export const toggleIsOn = (entry, forSaleIds) => entry.copy_ids.length > 0 && entry.copy_ids.every((id) => forSaleIds.has(id));
// Beim Einschalten merken: diese Vorschlaege waren schon vorher markiert.
export const premarkedIds = (entry, forSaleIds) => entry.copy_ids.filter((id) => forSaleIds.has(id));
// An: alle Vorschlaege auf for_sale = 1. Aus: alle Vorschlaege ausser den vorher markierten (premarked null = keine
// Vorgeschichte in dieser Ansicht) auf for_sale = 0.
export function toggleTargets(entry, on, premarked) {
  if (on) return { ids: [...entry.copy_ids], value: true };
  const keep = new Set(premarked || []);
  return { ids: entry.copy_ids.filter((id) => !keep.has(id)), value: false };
}
// "Alle Vorschläge auf die Verkaufsliste": alle vorgeschlagenen, noch nicht markierten Exemplare.
export const allProposalIds = (list, forSaleIds) =>
  (list || []).flatMap((e) => e.copy_ids).filter((id) => !forSaleIds.has(id));
