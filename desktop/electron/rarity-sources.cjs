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

/** Nennt diese Quelle wirklich eine Rarity? Leer und "Unknown" heissen beide: nein. */
function kenntRarity(rarity) {
  const r = String(rarity || '').trim();
  return r !== '' && r.toLowerCase() !== 'unknown';
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
function dropErfundeneRarity(sets) {
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

module.exports = { UNBEKANNT, kenntRarity, dropErfundeneRarity };
