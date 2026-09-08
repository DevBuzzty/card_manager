import { phoneSelectedSet } from './setCodeMatch.js';

// Spec D4 §4/§5: wohin ein WIEDERHOLTER Scan derselben Karte sein "+1" bucht, solange der PC das
// Staging fuehrt.
//
// Die Kotlin-Fassung derselben Regel steht in
// `android/.../ui/ScanAggregator.kt`. Dass es sie zweimal gibt, ist Absicht: die Zusammenfassung
// wohnt dort, wo das Staging steht -- offline am Handy, verbunden am PC. Wer hier etwas aendert,
// aendert dort mit.
//
// Ueber die Leitung kommt KEIN Modus-Feld. Im Modus "einzeln" faengt das Handy jede Wiederholung
// selbst ab; erreicht uns eine, war sie gewollt. Deshalb darf hier bedingungslos zusammengefasst
// werden.

// Verglichen wird die volle Druck-Identitaet, nicht nur der Set-Code: die Sammlung schluesselt auf
// (id, set_code, language, rarity) -- ein Secret Rare in einen Common zu falten schriebe den
// falschen Preis fort.
const keyOf = (s) => (s ? `${s.set_code}|${s.set_rarity}|${s.language}` : null);

/**
 * @param {object} card ein Eintrag der Staging-Liste
 * @param {object} scanned die Meldung des Handys ({ passcode, setCode, rarity, language })
 * @returns {{kind:'primary'} | {kind:'extra', index:number} | {kind:'newExtra', set:object}}
 *
 * Drei Faelle enden bewusst auf `primary`: kein gemeldeter Set-Code, eine noch ladende Karte
 * (keine Druckliste, gegen die verglichen werden koennte -- dieselbe Antwort, die das Handy im
 * Wettlauf gibt) und ein Druck, der sich nicht aufloesen laesst. Ein Zusatzdruck ohne
 * auflösbaren Druck waere schlimmer als ein "+1": `handleAdd` ueberspringt ihn wortlos, die
 * Kopie waere still verloren.
 */
export function aggregateTarget(card, scanned) {
  if (!scanned || !scanned.setCode) return { kind: 'primary' };
  if (card.status !== 'loaded' || !card.allPrintings) return { kind: 'primary' };
  const set = phoneSelectedSet(scanned.setCode, scanned.rarity, scanned.language, card.allPrintings);
  if (!set) return { kind: 'primary' };
  const wanted = keyOf(set);
  if (wanted === keyOf(card.selectedSet)) return { kind: 'primary' };
  const i = (card.extraPrintings || []).findIndex(p => keyOf(p.selectedSet) === wanted);
  if (i >= 0) return { kind: 'extra', index: i };
  return { kind: 'newExtra', set };
}

/**
 * Die Staging-Liste nach einer Handy-Meldung. Gibt immer ein NEUES Array zurueck (React-Zustand)
 * und fasst nur den Eintrag mit demselben Passcode an.
 *
 * Ein neuer Eintrag wird hinten angehaengt, damit die zuerst gescannte Karte oben stehen bleibt --
 * eine neu hinzukommende Karte laesst die Liste nach unten wachsen, ihre aufgeklappten Zeilen
 * koennen also nicht unten abgeschnitten werden.
 */
export function applyScan(cards, scanned) {
  const idx = cards.findIndex(c => c.passcode === scanned.passcode);
  if (idx < 0) {
    return [...cards, newEntry(scanned)];
  }
  const card = cards[idx];
  const target = aggregateTarget(card, scanned);
  let updated;
  if (target.kind === 'primary') {
    updated = { ...card, quantity: (card.quantity || 1) + 1 };
  } else if (target.kind === 'extra') {
    const extras = card.extraPrintings.map((p, i) =>
      i === target.index ? { ...p, quantity: (p.quantity || 1) + 1 } : p);
    updated = { ...card, extraPrintings: extras };
  } else {
    // edition/condition bleiben leer -- handleAdd setzt beim Uebernehmen die Voreinstellungen ein.
    const extra = { selectedSet: target.set, quantity: 1, edition: null, condition: null };
    updated = { ...card, extraPrintings: [...(card.extraPrintings || []), extra] };
  }
  return cards.map((c, i) => (i === idx ? updated : c));
}

// Spec D3 Task 8: die Felder, die ein aktuelles Handy mitschickt -- Set-Code, Rarity, Sprache,
// Edition, Ampel und Grund. Ein aelterer Handy-Stand sendet sie nicht; sie landen dann `undefined`
// und StagingArea faellt auf sein eigenes lokales Matching zurueck.
function newEntry(d) {
  return {
    tempId: Date.now() + Math.random(),
    passcode: d.passcode,
    scannedSetCandidates: d.setCodeCandidates || (d.setCode ? [d.setCode] : []),
    scannedSetCode: d.setCode,
    scannedRarity: d.rarity,
    scannedLanguage: d.language,
    scannedEdition: d.edition,
    scannedEditionConfidence: d.editionConfidence,
    scannedConfidence: d.confidence,
    scannedReason: d.reason,
    status: 'pending',
    data: null,
  };
}
