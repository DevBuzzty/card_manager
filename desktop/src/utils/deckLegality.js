// Spec E3 §4/§5 — Format, Legalitaetsregeln TCG/OCG, Badge-Texte, Banlist-Stufe und Kopien-Grenze.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckLegality.kt. Beide laufen gegen
// docs/fixtures/decks/legality.json. Wer eine Seite aendert, aendert beide.
import { canonicalPasscode, deckSectionFor } from './deckImport.js';

export const FORMATS = ['tcg', 'ocg', 'free'];
export const FORMAT_LABELS = { tcg: 'TCG', ocg: 'OCG', free: 'Frei' };
export const CATALOG_MISSING_BANLIST = 'Katalog fehlt – Banlist unbekannt';
export const COPY_LIMIT = 'Höchstens 3 Kopien je Karte';
export const FORMAT_SAVE_FAILED = 'Format konnte nicht gespeichert werden';
// Anzeige der Banlist-Stufe an der Kartenzeile (rot "Verboten", orange "1", gelb "2").
export const BAN_LABELS = { forbidden: 'Verboten', limited: '1', semi: '2' };

const SECTION_ORDER = ['main', 'extra', 'side'];
const MAX_COPIES = 3;
const BAN_MAX = { forbidden: 0, limited: 1, semi: 2 };

// Spec E3 §8: fehlt die Spalte format (SQL nicht eingespielt) oder steht Unbekanntes darin -> TCG.
export function normalizeFormat(format) {
  return FORMATS.includes(format) ? format : 'tcg';
}

// catalog: null (kein Katalog) oder { aliases: { Artwork: Haupt }, cards: { [Haupt-Passcode]: { name, type, ban_tcg, ban_ocg } } }.
function mainIdOf(passcode, catalog) {
  return catalog ? canonicalPasscode(passcode, catalog.aliases) : String(passcode);
}

// Banlist-Stufe einer Deckkarte im Format: 'forbidden' | 'limited' | 'semi' | null (uneingeschraenkt, Frei, unbekannt).
export function banOf(passcode, format, catalog) {
  const f = normalizeFormat(format);
  if (f === 'free' || !catalog) return null;
  const info = catalog.cards[mainIdOf(passcode, catalog)];
  const ban = info ? info[f === 'ocg' ? 'ban_ocg' : 'ban_tcg'] : null;
  return Object.hasOwn(BAN_MAX, ban || '') ? ban : null;
}

// cards: [{ card_id, name?, count, section }] (gespeicherter oder Editor-Stand; mehrere Zeilen je Passcode erlaubt).
// Ergebnis { legal, violations: [{ rule, cardId, text }], warnings: [{ cardId, text }] }; cardId = Haupt-Passcode oder null.
export function deckLegality(cards, format, catalog) {
  const f = normalizeFormat(format);
  if (f === 'free') return { legal: true, violations: [], warnings: [] };
  const rows = SECTION_ORDER.flatMap((s) => (cards || []).filter((c) => c && c.section === s && Number(c.count) > 0));
  const total = (s) => rows.filter((c) => c.section === s).reduce((a, c) => a + Number(c.count), 0);
  const violations = [];
  const warnings = [];

  const main = total('main');
  const extra = total('extra');
  const side = total('side');
  if (main < 40 || main > 60) violations.push({ rule: 1, cardId: null, text: `Main Deck: ${main} Karten (erlaubt 40–60)` });
  if (extra > 15) violations.push({ rule: 2, cardId: null, text: `Extra Deck: ${extra} Karten (höchstens 15)` });
  if (side > 15) violations.push({ rule: 3, cardId: null, text: `Side Deck: ${side} Karten (höchstens 15)` });
  if (!catalog) warnings.push({ cardId: null, text: CATALOG_MISSING_BANLIST });

  // Je Haupt-Passcode: erster Name (gespeicherter Deckkartenname, sonst Katalog, sonst Passcode), Summe, Abschnitte.
  const groups = new Map();
  for (const c of rows) {
    const id = mainIdOf(c.card_id, catalog);
    const info = catalog ? catalog.cards[id] : undefined;
    let g = groups.get(id);
    if (!g) {
      g = { id, name: c.name || (info && info.name) || id, info, count: 0, sections: [] };
      groups.set(id, g);
    }
    g.count += Number(c.count);
    if (!g.sections.includes(c.section)) g.sections.push(c.section);
  }

  const rule5 = [];
  const rule6 = [];
  for (const g of groups.values()) {
    if (catalog && !g.info) warnings.push({ cardId: g.id, text: `Banlist unbekannt: Passcode ${g.id}` });
    if (catalog && g.info && g.info.type) {
      const home = deckSectionFor(g.info.type);
      if (g.sections.includes('main') && home === 'extra') {
        violations.push({ rule: 4, cardId: g.id, text: `${g.name} im Main Deck gehört ins Extra Deck` });
      }
      if (g.sections.includes('extra') && home === 'main') {
        violations.push({ rule: 4, cardId: g.id, text: `${g.name} im Extra Deck gehört ins Main Deck` });
      }
    }
    const ban = catalog && g.info ? banOf(g.id, f, catalog) : null;
    if (ban === 'forbidden') rule6.push({ rule: 6, cardId: g.id, text: `${g.name} ist verboten` });
    else if (ban === 'limited' && g.count > 1) rule6.push({ rule: 6, cardId: g.id, text: `${g.name}: ${g.count} Kopien (limitiert 1)` });
    else if (ban === 'semi' && g.count > 2) rule6.push({ rule: 6, cardId: g.id, text: `${g.name}: ${g.count} Kopien (semi-limitiert 2)` });
    else if (g.count > MAX_COPIES) rule5.push({ rule: 5, cardId: g.id, text: `${g.name}: ${g.count} Kopien (höchstens 3)` });
  }
  violations.push(...rule5, ...rule6);
  return { legal: violations.length === 0, violations, warnings };
}

export const violationCountText = (n) => (n === 1 ? '1 Verstoß' : `${n} Verstöße`);

// "Legal" | "Legal · 1 Warnung" | "Legal · 2 Warnungen" | "1 Verstoß" | "3 Verstöße" | "Frei".
export function badgeText(result, format) {
  if (normalizeFormat(format) === 'free') return 'Frei';
  if (result.violations.length > 0) return violationCountText(result.violations.length);
  const w = result.warnings.length;
  if (w === 0) return 'Legal';
  return `Legal · ${w} ${w === 1 ? 'Warnung' : 'Warnungen'}`;
}

// Farbe des Badges: 'free' grau, 'legal' gruen, 'warn' gelb, 'crit' rot.
export function badgeKind(result, format) {
  if (normalizeFormat(format) === 'free') return 'free';
  if (result.violations.length > 0) return 'crit';
  return result.warnings.length > 0 ? 'warn' : 'legal';
}

// "Banlist-Stand: TT.MM.JJJJ" aus built_at (ISO, UTC-Datum wie gespeichert); ohne gueltiges Datum null.
export function banlistDateText(builtAt) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(builtAt || ''));
  return m ? `Banlist-Stand: ${m[3]}.${m[2]}.${m[1]}` : null;
}

// Spec E3 §5: darf eine weitere Kopie von `passcode` ins Deck? TCG/OCG: nicht, wenn die Karte (Haupt-Passcode, ueber alle
// Abschnitte) danach mehr als 3 Kopien haette; Frei immer. Die Banlist blockiert nie. aliases null = ohne Zuordnung.
export function canAddCopy(deckCards, passcode, format, aliases) {
  if (normalizeFormat(format) === 'free') return true;
  const id = canonicalPasscode(passcode, aliases);
  const have = (deckCards || [])
    .filter((c) => c && canonicalPasscode(c.card_id, aliases) === id)
    .reduce((a, c) => a + Math.max(0, Number(c.count) || 0), 0);
  return have + 1 <= MAX_COPIES;
}
