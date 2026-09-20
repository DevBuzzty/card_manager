// Eine erfundene Rarity ist schlimmer als keine.
//
// Gemessen am 20.09.2026: Konamis DEUTSCHE Kartendatenbank nennt zu KEINEM Druck eine Rarity
// (geprueft an Dupe Frog, cid 7788: kein einziges lr_icon). Unser Code machte daraus bisher
// "Common" -- und weil die Vorauswahl die NIEDRIGSTE Rarity nimmt (findBestDefaultSet am PC,
// RarityRank.lowest am Handy), gewann dieses erfundene Common jedes Mal. In einer Stichprobe von
// 14 eigenen Nicht-Common-Karten des Nutzers war das Ergebnis 14 von 14 mehrdeutig, immer mit
// Common dabei: BLGG-DE055 "Ultra Rare / Common", SHVA-DE013 "Secret Rare / Common", und so fort.
// Genau das ist die Beschwerde "Rarities erkennen ist noch immer schwierig" -- kein Erkennungs-,
// sondern ein Datenfehler.
//
// Der Kotlin-Zwilling steht in `android/.../cloud/RarityQuellen.kt`. Wer hier etwas aendert,
// aendert dort mit.

const UNBEKANNT = 'Unknown';

// YGOPRODeck schreibt "New" in set_rarity, solange die Rarity eines frisch erschienenen Sets noch
// nicht erfasst ist (gemessen 20.09.2026 an BLGG-EN045 "Fallin' Cheatah"). Im TCG gibt es keine
// Rarity dieses Namens -- sie als echte zu fuehren erzeugt dieselbe falsche Mehrdeutigkeit wie das
// frueher erfundene Common ("Rarity mehrdeutig: Ultra Rare/New" steht so im Scan-Protokoll).
const PLATZHALTER = new Set(['unknown', 'new']);

/**
 * Nennt diese Quelle wirklich eine Rarity? Leer, "Unknown" und "New" heissen alle drei: nein --
 * und ebenso eine Angabe OHNE JEDEN BUCHSTABEN.
 *
 * Letzteres stammt aus einem echten Lauf (20.09.2026): fuer das frische Set "Legendary Arc-V
 * Decks" liefert YGOPRODeck `set_rarity: "3"` bzw. "2" (94 Drucke im Katalog). Als Rarity gefuehrt
 * ergibt das Anzeigen wie "Rarity mehrdeutig: 3/Secret Rare/Starlight Rare".
 */
function kenntRarity(rarity) {
  const r = String(rarity || '').trim();
  if (r === '' || PLATZHALTER.has(r.toLowerCase())) return false;
  return /[A-Za-z]/.test(r);
}

/**
 * Ein Druck-Code aus einer QUELLE (nicht aus der OCR), mit den zwei Zeichen repariert, die dort
 * nie stehen koennen.
 *
 * Auch das ist gemessen, nicht vermutet: YGOPRODeck fuehrt die Karten von "Legendary Arc-V Decks"
 * als "LAVD-ENO11" -- Buchstabe O statt Null. Auf der Karte steht "LAVD-DE011", die OCR des
 * Nutzers las das am 20.09. korrekt, und unser Code stellte die kaputte Quelle darueber und bot
 * "LAVD-DEO11" an, das von Hand korrigiert werden musste. Im ganzen Katalog steht dieses O NUR bei
 * LAVD (55 Drucke), es ist also kein echter Variantenbuchstabe -- den gibt es (SGX3-DEA10), aber
 * niemals als O oder I: Konami druckt keine Zeichen, die mit 0 und 1 verwechselbar sind.
 */
function repariereQuellcode(code) {
  const c = String(code || '').trim().toUpperCase();
  const m = /^([A-Z0-9]{2,6})-([A-Z]{1,2})([OI])(\d{1,4})$/.exec(c);
  if (!m) return String(code || '').trim();
  return `${m[1]}-${m[2]}${m[3] === 'O' ? '0' : '1'}${m[4]}`;
}

/**
 * Drucke aus mehreren Quellen zusammenfuehren: kennt EINE Quelle die Rarity eines Codes, zaehlen
 * nur noch die Zeilen MIT Rarity. Kennt keine sie, bleibt genau eine Zeile mit "Unknown" ueber --
 * ehrlich, statt "Common" zu raten.
 *
 * Mehrere ECHTE Rarities zu einem Code bleiben erhalten (MAMO-DE015 gibt es als Ultra Rare UND als
 * Starlight Rare) -- das ist eine echte Mehrdeutigkeit, ueber die die Ampel reden darf.
 * Reihenfolge und Zusatzfelder der Eingabe bleiben unangetastet.
 */
function dropErfundeneRarity(roh) {
  // Erst die Codes reparieren, dann gruppieren: sonst stuenden "LAVD-ENO11" und ein anderswo
  // sauber geliefertes "LAVD-EN011" als zwei verschiedene Drucke nebeneinander.
  const sets = (roh || []).map(s => (s.set_code ? { ...s, set_code: repariereQuellcode(s.set_code) } : s));
  const kennt = new Set();
  for (const s of sets || []) {
    if (kenntRarity(s.set_rarity)) kennt.add(String(s.set_code || '').toUpperCase());
  }
  const out = [];
  const gesehen = new Set();
  for (const s of sets || []) {
    const code = String(s.set_code || '').toUpperCase();
    if (kennt.has(code)) {
      if (kenntRarity(s.set_rarity)) out.push(s);
      continue;
    }
    // Keine Quelle kennt die Rarity dieses Codes: EINE Zeile, ehrlich als unbekannt gekennzeichnet.
    if (gesehen.has(code)) continue;
    gesehen.add(code);
    out.push({ ...s, set_rarity: UNBEKANNT });
  }
  return out;
}

module.exports = { UNBEKANNT, kenntRarity, repariereQuellcode, dropErfundeneRarity };
