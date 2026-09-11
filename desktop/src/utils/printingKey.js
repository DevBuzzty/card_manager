/**
 * Die vierspaltige Identitaet einer Druckvariante als ein Schluessel:
 * (id, set_code, language, rarity) -- derselbe zusammengesetzte Primaerschluessel wie in der
 * Tabelle `cards`.
 *
 * EINE Stelle, absichtlich: die Sprach-Vorgabe `|| 'DE'` und die Reihenfolge der Spalten muessen
 * ueberall gleich sein, sonst greifen Name, Bild und Preis an genau der Stelle ins Leere, die man
 * beim Aendern uebersehen hat -- und zwar still, ohne Fehler.
 *
 * Zwei Ableiter, weil zwei Tabellen die erste Spalte verschieden nennen: `cards` nennt sie `id`,
 * `card_copies` nennt sie `card_id`. Fuer dieselbe Druckvariante liefern beide denselben
 * Schluessel (in printingKey.test.js festgehalten).
 */
export const printingKey = (p) => `${p.id}|${p.set_code}|${p.language || 'DE'}|${p.rarity}`;

export const copyKey = (cp) => `${cp.card_id}|${cp.set_code}|${cp.language || 'DE'}|${cp.rarity}`;
