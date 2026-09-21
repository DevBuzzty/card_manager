// Spec F1 §4 -- Formatierer fuer die Exporte ausser Card Dex (carddex-format.cjs). Rein: Eingabe sind die Exemplar-Zeilen
// aus collection-export.cjs#loadExportCopies bzw. die Wunschliste, dazu ein Nachschlagen des englischen Namens.
// Unknown-Printings: leerer Set-Code in den CSV-Formaten, in der Verkaufsliste weggelassen (gezaehlt in `omitted`).
const { toCsv } = require('./csv.cjs');
const { EDITIONS, CONDITIONS, unitPrice, conditionFactor } = require('./valuation.cjs');
const { suggestionCents, marketValueCents } = require('./sales-math.cjs');

const DS_CONDITION = { MT: 'Near Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
const DS_PRINTING = { first: '1st Edition', unlimited: 'Unlimited', limited: 'Limited', unknown: '' };
const DS_LANGUAGE = { DE: 'German', EN: 'English', JP: 'Japanese', FR: 'French', IT: 'Italian', SP: 'Spanish', PT: 'Portuguese' };
const SALE_EDITION = { first: '1. Auflage', unlimited: 'Unlimitiert', limited: 'Limitiert', unknown: null };

const isUnknown = (cp) => !cp.set_code || cp.set_code === 'Unknown';
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'de');
const cents = (v) => Math.round(v * 100) / 100;
const eur = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euroText = (v) => `${eur.format(cents(v))} €`;

// Stueckwert wie in der Wertanzeige: unitPrice (1.-Auflage-Preis bei edition = 'first', G4) x Zustandsfaktor.
const pieceValue = (cp) => cents(unitPrice(cp, cp) * conditionFactor(cp.condition));

// Gruppen gleicher Schluessel mit Anzahl; `keyOf` bestimmt die Gruppierung, die erste Zeile traegt die Felder.
function groupBy(copies, keyOf) {
  const m = new Map();
  for (const cp of copies || []) {
    const k = JSON.stringify(keyOf(cp));
    const hit = m.get(k);
    if (hit) hit.count += 1; else m.set(k, { ...cp, count: 1 });
  }
  return [...m.values()];
}
const printingOf = (cp) => [String(cp.card_id), cp.set_code, cp.language, cp.rarity];
// nameOf(g) einmal je Gruppe vor dem Sortieren bestimmen und als `_nameEn` an die Gruppe haengen, nicht im
// Comparator (der O(n log n)-mal laeuft) und nicht ein zweites Mal beim Bauen der Ausgabezeile -- nameOf ruft bei
// den CSV-Exporten `nameEn` auf, was bei jedem Aufruf den Katalog nachschlaegt (I1).
function sortGroups(groups, nameOf) {
  const named = groups.map((g) => ({ ...g, _nameEn: nameOf(g) }));
  named.sort((a, b) => byText(a._nameEn, b._nameEn)
    || byText(a.set_code, b.set_code) || byText(a.rarity, b.rarity) || byText(a.language, b.language)
    || EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)
    || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition));
  return named;
}

// nameEn(passcode) -> englischer Katalogname oder null; Rueckfall ist der lokale Name.
const englishName = (nameEn, cp) => (nameEn && nameEn(String(cp.card_id))) || cp.name || '';

function dragonShieldCsv(copies, nameEn) {
  const groups = sortGroups(groupBy(copies, (cp) => [...printingOf(cp), cp.edition, cp.condition]), (g) => englishName(nameEn, g));
  return toCsv([
    ['Quantity', 'Card Name', 'Set Code', 'Rarity', 'Language', 'Printing', 'Condition', 'Price'],
    ...groups.map((g) => [
      g.count, g._nameEn, isUnknown(g) ? '' : g.set_code, g.rarity, DS_LANGUAGE[g.language] || g.language,
      DS_PRINTING[g.edition] ?? '', DS_CONDITION[g.condition] || '', pieceValue(g).toFixed(2),
    ]),
  ]);
}

function ygoprodeckCsv(copies, nameEn) {
  const groups = sortGroups(groupBy(copies, printingOf), (g) => englishName(nameEn, g));
  return toCsv([
    ['cardname', 'cardq', 'cardrarity', 'cardcode', 'cardid'],
    ...groups.map((g) => [g._nameEn, g.count, g.rarity, isUnknown(g) ? '' : g.set_code, String(g.card_id)]),
  ]);
}

// wishlist: Zeilen aus get-wishlist ({ card_id, name }). Eine Zeile je Eintrag, Menge 1 (die Wunschliste kennt keine
// Menge und kein Printing).
function cardmarketWantslist(wishlist, nameEn) {
  const lines = (wishlist || [])
    .map((w) => ({ name: (nameEn && nameEn(String(w.card_id))) || w.name || String(w.card_id) }))
    .sort((a, b) => byText(a.name, b.name))
    .map((w) => `1 ${w.name}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

// -> { text, omitted } ; omitted = Anzahl weggelassener Unknown-Exemplare.
// Spec H2 §9, Plan-Abweichung 6 -- die Preisspalte zeigt den Preisvorschlag (Marktwert minus
// Abschlag, nie unter dem Mindestpreis), nicht den Marktwert: der Export ist eine Liste zum
// Anbieten. rule kommt von den Einstellungen (collection-export.cjs); ohne Aufrufer der Standard.
function saleListText(copies, rule = { discount: 5, minCents: 10 }) {
  const known = (copies || []).filter((cp) => !isUnknown(cp));
  // Preisfelder mit in den Gruppenschluessel: reale Zeilen derselben Druckvariante teilen sich
  // ohnehin denselben Kartenpreis (Join auf `cards`), aber der Vorschlag haengt am Preis -- ein
  // Exemplar ohne Preis darf ein preistragendes derselben Druckvariante nicht in eine Gruppe reissen.
  const groups = sortGroups(groupBy(known, (cp) => [...printingOf(cp), cp.edition, cp.condition, cp.price, cp.price_first_ed]), (g) => g.name);
  let total = 0;
  let sumCents = 0;
  const lines = groups.map((g) => {
    const sugg = suggestionCents(marketValueCents(g, g), rule.discount, rule.minCents);
    total += g.count;
    sumCents += (sugg ?? 0) * g.count;
    const parts = [`${g.count}× ${g.name || String(g.card_id)}`, g.set_code, g.rarity, SALE_EDITION[g.edition], g.condition,
      sugg != null ? euroText(sugg / 100) : 'ohne Preis'];
    return parts.filter((p) => p != null && p !== '').join(' – ');
  });
  const text = lines.length ? `${lines.join('\n')}\n\nSumme: ${total} ${total === 1 ? 'Karte' : 'Karten'} · ${euroText(sumCents / 100)}\n` : '';
  return { text, omitted: (copies || []).length - known.length };
}

module.exports = { DS_CONDITION, DS_PRINTING, DS_LANGUAGE, pieceValue, euroText, isUnknown, dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText };
