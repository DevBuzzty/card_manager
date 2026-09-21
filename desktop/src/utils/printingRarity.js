// Ein Druck ohne Rarity uebernimmt sie von seinem gleichnummerigen Geschwister in einer anderen Sprache.
//
// Anlass (21.09.2026, Nutzer): viele Zeilen zeigten trotz gruener Ampel "Druckvariante waehlen",
// in der Liste stand "MAMO-DE072 - Unknown". MAMO ist am 04.09. erschienen; die Wiki-Antworten im
// Zwischenspeicher der App stammten aus der Zeit, als dort noch keine Rarity eingetragen war. Seit
// dem Rarity-Fix vom 20.09. wird daraus ehrlich "Unknown" statt eines erfundenen "Common" -- aber
// das Handy meldet "MAMO-DE072, Ultra Rare", findet in der Liste keinen solchen Eintrag, und das
// Auswahlfeld bleibt leer.
//
// YGOPRODeck kennt den englischen Zwilling (MAMO-EN072, Ultra Rare). Ein Druck hat in allen
// Sprachen dieselbe Rarity -- dieselbe Annahme trifft das Handy seit Spec D3 (SetCodeMatch,
// "Rarity is assumed the same across languages of the same printing"). Deshalb wird eine
// unbekannte Rarity aus den Geschwistern mit gleichem Praefix und gleicher Nummer aufgefuellt.
// Kennen die Geschwister MEHRERE Rarities (Ultra UND Starlight), entsteht je Rarity eine Zeile --
// beides gibt es dann auch in dieser Sprache, und der Nutzer waehlt.

const PLATZHALTER = new Set(['', 'unknown', 'new']);

// Gleiche Regel wie rarity-sources.cjs#kenntRarity (Hauptprozess): leer, Unknown, New und reine
// Zahlen ("3") sind keine Auskunft.
export function kenntRarity(rarity) {
  const r = String(rarity || '').trim();
  return !PLATZHALTER.has(r.toLowerCase()) && /[A-Za-z]/.test(r);
}

// Praefix + Nummer, ohne Region -- MAMO-DE072 und MAMO-EN072 sind dieselbe Druckzeile.
function zeile(code) {
  const m = /^([A-Z0-9]{2,6})-([A-Z]{1,2})([A-Z]?\d{1,4})$/.exec(String(code || '').trim().toUpperCase());
  return m ? `${m[1]}|${m[3].replace(/^([A-Z]?)0+(?=\d)/, '$1')}` : null;
}

export function fuelleRarityAusGeschwistern(printings) {
  const bekannt = new Map();   // zeile -> [Rarities in Reihenfolge]
  for (const p of printings || []) {
    const z = zeile(p.set_code);
    if (!z || !kenntRarity(p.set_rarity)) continue;
    const liste = bekannt.get(z) || [];
    if (!liste.includes(p.set_rarity)) liste.push(p.set_rarity);
    bekannt.set(z, liste);
  }
  const out = [];
  const gesehen = new Set();
  const nimm = (p) => {
    const key = `${p.set_code}|${p.set_rarity}|${p.language}`;
    if (gesehen.has(key)) return;
    gesehen.add(key);
    out.push(p);
  };
  for (const p of printings || []) {
    const geschwister = kenntRarity(p.set_rarity) ? null : bekannt.get(zeile(p.set_code));
    if (geschwister && geschwister.length > 0) {
      for (const r of geschwister) nimm({ ...p, set_rarity: r, rarityVonGeschwister: true });
    } else {
      nimm(p);
    }
  }
  return out;
}
