// Der gelesene Set-Code ist die STAERKERE Identitaet als die Bildaehnlichkeit.
//
// Der Anlass (Nutzer 19./20.09.2026): 13 der 19 "Solfachord"-Karten stecken nur in ANGU, ihre
// Artworks aehneln sich stark. Die Bilderkennung griff die falsche Schwesterkarte, und danach war
// alles Folgefehler -- eine ANGU-Karte kann nur ANGU-Drucke vorschlagen, "MAMO-DE103" konnte gar
// nicht mehr herauskommen. Umgekehrt bestimmt MAMO-DE103 die Karte eindeutig, waehrend ANGU-DE103
// nachweislich nicht existiert (ANGU hat nur 60 Karten).
//
// Verglichen wird IMMER nur Praefix + Nummer, nie die Region: YGOPRODeck fuehrt die englischen
// Codes (MAMO-EN103), gelesen wird der deutsche (MAMO-DE103) -- dieselbe Druckzeile.
// Gleiche Trennung wie SetCodeMatch.parts() am Handy.
const CODE = /^([A-Z0-9]{2,6})-([A-Z]{1,2})([A-Z])?(\d{1,4})$/;

/** { prefix, number } eines sauberen Codes; null, wenn er diese Grammatik nicht hat. */
function codeKey(code) {
  const m = CODE.exec(String(code || '').trim().toUpperCase().replace(/\s+/g, ''));
  if (!m) return null;
  // Fuehrende Nullen weg, damit MAMO-DE103 und MAMO-EN0103 derselbe Druck sind.
  return { prefix: m[1], number: (m[3] || '') + m[4].replace(/^0+(?=\d)/, '') };
}

const sameKey = (a, b) => !!a && !!b && a.prefix === b.prefix && a.number === b.number;

/** Gehoert der gelesene Code zu einem der Drucke dieser Karte? (card_sets von YGOPRODeck) */
function belongsToCard(code, cardSets) {
  const k = codeKey(code);
  if (!k) return false;
  return (cardSets || []).some(s => sameKey(codeKey(s.set_code), k));
}

/**
 * Passcode zu einem gelesenen Set-Code, oder null.
 *
 * deps.listSets()          -> [{ set_name, set_code }]   (cardsets.php)
 * deps.cardsOfSet(name)    -> [{ id, name, card_sets }]  (cardinfo.php?cardset=…)
 *
 * Gibt NUR bei genau einem Treffer etwas zurueck. Mehrere Karten mit derselben Nummer in einem Set
 * gibt es eigentlich nicht -- wenn doch, ist der Code nicht eindeutig und darf nichts entscheiden.
 */
async function resolveSetCode(deps, code) {
  const k = codeKey(code);
  if (!k) return null;
  const sets = (await deps.listSets()) || [];
  const set = sets.find(s => String(s.set_code || '').toUpperCase() === k.prefix);
  if (!set) return null;
  const cards = (await deps.cardsOfSet(set.set_name)) || [];
  const hits = cards.filter(c => (c.card_sets || []).some(s => sameKey(codeKey(s.set_code), k)));
  if (hits.length !== 1) return null;
  return { id: String(hits[0].id), name: hits[0].name, setName: set.set_name };
}

module.exports = { codeKey, belongsToCard, resolveSetCode };
