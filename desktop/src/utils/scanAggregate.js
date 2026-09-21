import { phoneSelectedSet, mapPhoneConfidence } from './setCodeMatch.js';

// Spec D4 §4/§5: wohin ein WIEDERHOLTER Scan derselben Karte sein "+1" bucht, solange der PC das
// Staging fuehrt.
//
// Die Kotlin-Fassung derselben Regel steht in
// `android/.../ui/ScanAggregator.kt`. Dass es sie zweimal gibt, ist Absicht: die Zusammenfassung
// wohnt dort, wo das Staging steht -- offline am Handy, verbunden am PC. Wer hier etwas aendert,
// aendert dort mit.
//
// Spec-Fix I2: ueber die Leitung kommt EIN Modus-Feld ("einzeln"/"stapel", woertlich wie am Handy).
// Die urspruengliche Annahme -- das Handy fange im Modus "einzeln" jede Wiederholung selbst ab,
// also brauche die Leitung kein Modus-Feld -- ist widerlegt: die Merkliste des Handys (`seen` in
// ScanScreen.kt) lebt nur, solange der Scanner offen ist; die Staging-Liste des PCs ueberlebt ein
// Schliessen/Wiederoeffnen des Scanners. Ohne das Feld zaehlte Modus "einzeln" bei verbundenem PC
// doppelt. Ein FEHLENDES Feld (aelteres Handy) gilt als "einzeln" -- das ist die Richtung, die
// niemals stillschweigend eine Menge erhoeht.

// Verglichen wird die volle Druck-Identitaet, nicht nur der Set-Code: die Sammlung schluesselt auf
// (id, set_code, language, rarity) -- ein Secret Rare in einen Common zu falten schriebe den
// falschen Preis fort.
// Modi, in denen eine Wiederholung "+1" bucht. Alles andere (auch ein fehlendes Feld) verwirft sie.
const ZUSAMMENFASSEN = new Set(['stapel', 'foto']);

const keyOf = (s) => (s ? `${s.set_code}|${s.set_rarity}|${s.language}` : null);

/**
 * @param {object} card ein Eintrag der Staging-Liste
 * @param {object} scanned die Meldung des Handys ({ passcode, setCode, rarity, language })
 * @returns {{kind:'primary'} | {kind:'extra', index:number} | {kind:'newExtra', set:object}}
 *
 * Vier Faelle enden bewusst auf `primary`: kein gemeldeter Set-Code, kein Hauptdruck, eine noch
 * ladende Karte (keine Druckliste, gegen die verglichen werden koennte -- dieselbe Antwort, die
 * das Handy im Wettlauf gibt) und ein Druck, der sich nicht aufloesen laesst. Ein Zusatzdruck ohne
 * auflösbaren Druck waere schlimmer als ein "+1": `handleAdd` ueberspringt ihn wortlos, die
 * Kopie waere still verloren.
 */
export function aggregateTarget(card, scanned) {
  if (!scanned || !scanned.setCode) return { kind: 'primary' };
  // Gegenstueck zu `key(primary) ?: return Target.Primary` in ScanAggregator.kt -- beide Stellen
  // aendern sich zusammen. Unbedingt noetig, denn `card.status === 'loaded'` UND
  // `card.selectedSet === null` sind gleichzeitig erreichbar: liefert YGOPRODeck fuer einen
  // Passcode ein leeres `card_sets`, ist `enPrintings` in StagingArea.jsx ein LEERES aber WAHRES
  // Array -- der `!card.allPrintings`-Wächter unten besteht es, `enPrintings[0]` ist `undefined`,
  // und ohne Treffer vom Handy/lokalen Matching wird `selectedSet: null` gesetzt (StagingArea.jsx
  // ~Zeile 121). Ohne diese Pruefung wuerde eine solche Karte faelschlich gegen `extraPrintings`
  // verglichen statt bedingungslos den Hauptdruck zu zaehlen.
  if (!card.selectedSet) return { kind: 'primary' };
  // M3: defensive Redundanz nach der Pruefung direkt darueber -- sobald `card.selectedSet` gesetzt
  // ist, ist die Karte im heutigen Code immer bereits `status: 'loaded'` und traegt `allPrintings`
  // (beides setzt StagingArea gemeinsam). Diese Zeile greift also nie eigenstaendig; sie bleibt als
  // Absicherung stehen, falls sich das je aendert.
  if (card.status !== 'loaded' || !card.allPrintings) return { kind: 'primary' };
  const set = phoneSelectedSet(scanned.setCode, scanned.rarity, scanned.language, card.allPrintings);
  if (!set) return { kind: 'primary' };
  const wanted = keyOf(set);
  if (wanted === keyOf(card.selectedSet)) return { kind: 'primary' };
  const i = (card.extraPrintings || []).findIndex(p => keyOf(p.selectedSet) === wanted);
  if (i >= 0) return { kind: 'extra', index: i };
  return { kind: 'newExtra', set };
}

// Rueckfall-Voreinstellungen, falls der Aufrufer keine (oder keine vollstaendigen) `defaults`
// mitgibt -- dieselben Werte, die CopyChip.jsx als Standardparameter kennt (edition='unknown',
// condition='NM'), damit eine neu angelegte Zusatzzeile nie von der Anzeige abweicht.
const FALLBACK_DEFAULTS = { edition: 'unknown', condition: 'NM' };

/**
 * Die Staging-Liste nach einer Handy-Meldung. Gibt immer ein NEUES Array zurueck (React-Zustand)
 * und fasst nur den Eintrag mit demselben Passcode an.
 *
 * Ein neuer Eintrag wird hinten angehaengt, damit die zuerst gescannte Karte oben stehen bleibt --
 * eine neu hinzukommende Karte laesst die Liste nach unten wachsen, ihre aufgeklappten Zeilen
 * koennen also nicht unten abgeschnitten werden. Das gilt UNABHAENGIG vom Modus-Feld: eine erste
 * Sichtung wird immer angelegt, auch wenn `scanned.mode` fehlt.
 *
 * @param {object} defaults Vorbelegung fuer einen neu angelegten Zusatzdruck ({ edition, condition
 *   }), z.B. aus `window.api.getDefaults()`. Spec-Fix I3: ein neuer Zusatzdruck erbt sie, wie der
 *   Kotlin-Zwilling in ScanScreen.kt:328-334 -- vorher blieben edition/condition `null`, was
 *   CopyChip.jsx als "vom Standard abweichend" gold markierte, obwohl beim Uebernehmen exakt die
 *   Voreinstellung greift.
 */
export function applyScan(cards, scanned, defaults = FALLBACK_DEFAULTS) {
  const idx = cards.findIndex(c => c.passcode === scanned.passcode);
  if (idx < 0) {
    return [...cards, newEntry(scanned)];
  }
  // Spec-Fix I2: eine Wiederholung wird nur in den Modi "stapel" und "foto" zusammengefasst. Ist
  // `scanned.mode` etwas anderes oder fehlt es ganz, bleibt die Liste unveraendert (dieselbe
  // Array-Referenz) -- sicherer, als stillschweigend eine Menge zu erhoehen.
  // "foto" (21.09.2026): im Fotomodus ist jeder Knopfdruck eine bewusste Aktion, also eine Karte
  // -- dreimal dieselbe Karte fotografiert heisst drei Stueck (Nutzerentscheid). Der Kotlin-Zwilling
  // der Entscheidung steht in ScanCapture.onFoto.
  if (!ZUSAMMENFASSEN.has(scanned.mode)) return cards;
  const card = cards[idx];
  const target = aggregateTarget(card, scanned);
  let updated;
  if (target.kind === 'primary') {
    updated = { ...zieheAmpelNach(card, scanned), quantity: (card.quantity || 1) + 1 };
  } else if (target.kind === 'extra') {
    const extras = card.extraPrintings.map((p, i) =>
      i === target.index ? { ...p, quantity: (p.quantity || 1) + 1 } : p);
    updated = { ...card, extraPrintings: extras };
  } else {
    // Spec-Fix C1: eine id nach demselben Muster wie `addPrinting` in StagingArea.jsx -- ohne sie
    // schluesselt das gesamte Zusatzdruck-UI (updatePrinting/removePrinting/key) auf `undefined`
    // und trifft bei zwei automatisch angelegten Zeilen versehentlich beide gleichzeitig.
    const extra = {
      id: `${Date.now()}-${Math.random()}`,
      selectedSet: target.set,
      quantity: 1,
      ...werteFuerZusatz(card, scanned, defaults),
    };
    updated = { ...card, extraPrintings: [...(card.extraPrintings || []), extra] };
  }
  return cards.map((c, i) => (i === idx ? updated : c));
}

/**
 * Auflage und Zustand einer NEUEN Zusatzzeile (Nutzer 19.09.2026: "wenn eine zweite Sprache erkannt
 * wird, steht da NM unbekannt"). Bisher erbte sie stur die PC-Voreinstellung, und die steht meist auf
 * "unknown". Jetzt, in dieser Reihenfolge:
 *   Auflage: was das Handy an DIESEM Exemplar erkannt hat -> die der Hauptzeile -> Voreinstellung
 *   Zustand: der der Hauptzeile -> Voreinstellung
 * "unknown" vom Handy zaehlt nicht als Erkennung -- es ist dessen eigener Rueckfall, wenn die
 * Auflagenzeile nicht lesbar war. Der Zustand wird nie erkannt, nur uebernommen.
 * Auch fuer den "+ Weitere Druckvariante"-Knopf (StagingArea.addPrinting, dort ohne `scanned`).
 */
export function werteFuerZusatz(card, scanned, defaults = FALLBACK_DEFAULTS) {
  const erkannt = scanned && scanned.edition && scanned.edition !== 'unknown' ? scanned.edition : null;
  const haupt = card && card.edition && card.edition !== 'unknown' ? card.edition : null;
  return {
    edition: erkannt || haupt || defaults.edition,
    condition: (card && card.condition) || defaults.condition,
  };
}

// Rangfolge der Handy-Ampel. Unbekannt (aelteres Handy, kein Feld) steht unter Rot.
const AMPEL_RANG = { red: 1, yellow: 2, green: 3 };

/**
 * Ein weiterer Druck auf DENSELBEN Druck einer Zeile zieht deren Ampel nach -- aber nur nach oben
 * (Nutzerentscheid 21.09.2026). Anlass: im Fotomodus war der zweite Druck einer Karte gruen, die
 * Zeile am PC zeigte aber weiter das Gelb des ersten, weil "+1" bisher nur die Menge anfasste.
 *
 * Nie nach unten: ein spaeterer, schlechterer Druck widerlegt den besseren nicht, er hat nur
 * weniger gesehen. Und nie ueber eine Handkorrektur (`setTouched`, `isManualEntry`): hat der
 * Nutzer den Druck selbst gewaehlt, beschreibt die Ampel des Handys nicht mehr, was dasteht.
 */
function zieheAmpelNach(card, scanned) {
  if (card.setTouched || card.isManualEntry) return card;
  const neu = AMPEL_RANG[scanned.confidence] || 0;
  const alt = AMPEL_RANG[card.scannedConfidence] || 0;
  if (neu <= alt) return card;
  const out = { ...card, scannedConfidence: scanned.confidence, scannedReason: scanned.reason };
  // Ist die Karte schon geladen, sind die angezeigten Werte bereits aus der alten Ampel abgeleitet
  // (StagingArea.fetchCard) -- sie muessen mit. Laedt sie noch, liest fetchCard die neue selbst.
  if (card.status === 'loaded') {
    out.setMatchConfidence = mapPhoneConfidence(scanned.confidence);
    out.setAutoDetected = scanned.confidence !== 'red';
  }
  return out;
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
    // Nur zur Anzeige: der PC hat den Passcode nach dem gelesenen Set-Code getauscht (main.cjs).
    correctedBy: d.correctedBy,
    correctedFrom: d.correctedFrom,
    status: 'pending',
    data: null,
  };
}
