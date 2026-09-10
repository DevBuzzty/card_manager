// Spec B2 §7.2: die reinen Rechnungen hinter der Binder-Ansicht -- Rasterform, Seitenzahl, welches
// Exemplar in welchem Fach einer Seite liegt, und die Textsuche ueber die einsortierbaren
// Exemplare. Alles hier laeuft ohne React und wird in binderGrid.test.js geprueft; die Ansicht
// (components/BinderView.jsx) trifft keine dieser Entscheidungen selbst.
//
// Die Kotlin-Fassung derselben Regeln steht in
// android/app/src/main/java/com/example/yugiohscanner/ml/BinderGrid.kt (Tests: BinderGridTest.kt).
// Dass es sie zweimal gibt, ist Absicht -- beide Geraete zeigen denselben Ordner mit denselben
// Faechern. Wer hier etwas aendert, aendert dort mit; beide Testsuiten pruefen dieselben Faelle
// mit denselben Eingaben, bis auf die unten genannten Abweichungen, die es in Kotlin nicht geben
// kann.
//
// Die Zurechtrueckung von `pockets` kommt aus slotMath.js#clampPockets und wird hier NICHT
// nachgebaut: ein Ordner ohne (oder mit unsinniger) Fachzahl zaehlt in der ganzen App als
// 4er-Ordner, an genau einer Stelle entschieden. (Kotlin macht es genauso, dort ueber
// SlotMath.clampPockets.)
//
// Der Begriff "belegt" ist hier derselbe wie in slotMath.js#firstFree: ein Exemplar mit einem
// Fach JENSEITS der aktuellen Seitengroesse (Rest einer frueheren, groesseren Ordnergroesse) gilt
// NICHT als einsortiert. Das ist wichtig, weil es sonst unsichtbar waere -- kein Fach des Rasters
// kann es zeigen. Solche Exemplare liefert `loose` zurueck, damit die Ansicht sie neben dem
// Raster auffuehrt.
//
// Wirft nie: gerufen wird das hier aus einer Ansicht heraus, ein Absturz beim Blaettern waere
// schlimmer als ein leeres Fach.
//
// NICHT identisch mit der Kotlin-Fassung, weil der Renderer -- anders als Kotlin -- nichts
// typisiert (gleiche Ueberlegung wie in slotMath.js):
// - page/slot laufen durch Number(...) + Math.trunc(...), bevor sie verglichen werden. Die Werte
//   stammen aus SQLite und aus <input>-Feldern (CopySheet), also mal als Zahl, mal als
//   Zeichenkette ("2"). Kotlins `Int?` kann eine Zeichenkette nicht entgegennehmen.
// - Alle Listenparameter vertragen undefined/null wie eine leere Liste, alle Textfelder ein
//   fehlendes Feld wie den leeren Text. Kotlins Signaturen (List<CopyRow>, String) kennen das
//   nicht.

import { clampPockets } from './slotMath.js';
import { parseTags } from './tags.js';

const toInt = (n) => Math.trunc(Number(n));
const list = (l) => (Array.isArray(l) ? l : []);
const text = (v) => (v == null ? '' : String(v));

/** 4 Faecher -> 2 Spalten (2x2), 9 -> 3 (3x3), 12 -> 3 (3x4). */
export function columns(pockets) {
  return clampPockets(pockets) <= 4 ? 2 : 3;
}

/** Liegt dieses Exemplar in einem Fach, das das Raster dieser Ordnergroesse zeigen kann? */
export function isPlaced(copy, pockets) {
  if (!copy || copy.page == null || copy.slot == null) return false;
  const p = clampPockets(pockets);
  const page = toInt(copy.page);
  const slot = toInt(copy.slot);
  return page >= 1 && slot >= 1 && slot <= p;
}

/**
 * Spec 5.3: die hoechste BELEGTE Seite, nie ceil(Anzahl / Faecher). Mindestens 1, damit ein leerer
 * Ordner eine (leere) erste Seite zum Blaettern hat.
 *
 * Kein Math.max(...array): bei sehr vielen Exemplaren sprengt das Auseinanderziehen als
 * Funktionsargumente die Aufrufstapel-Grenze der Engine -- ein Wurf, den es laut Kopfkommentar nie
 * geben darf und den Kotlins maxOrNull (kein Argument-Spread) nicht kennt. Dieselbe Ueberlegung
 * steht in slotMath.js#firstFree.
 */
export function pageCount(copies, pockets) {
  let highest = 0;
  for (const c of list(copies)) {
    if (!isPlaced(c, pockets)) continue;
    const page = toInt(c.page);
    if (page > highest) highest = page;
  }
  return highest > 0 ? highest : 1;
}

/**
 * Die Faecher EINER Seite, von Fach 1 an: Ergebnis[i] sind die Exemplare in Fach i+1. Die Liste
 * ist immer genau `pockets` lang (leere Faecher sind leere Listen), und mehrere Exemplare im
 * selben Fach bleiben in Eingabereihenfolge stehen -- daran haengt das Mengen-Abzeichen.
 */
export function slots(copies, page, pockets) {
  const p = clampPockets(pockets);
  const wanted = toInt(page);
  const out = Array.from({ length: p }, () => []);
  for (const c of list(copies)) {
    if (!isPlaced(c, p) || toInt(c.page) !== wanted) continue;
    out[toInt(c.slot) - 1].push(c);
  }
  return out;
}

/** Exemplare des Behaelters, die kein anzeigbares Fach haben -- Box/Deckbox komplett. */
export function loose(copies, pockets) {
  return list(copies).filter((c) => !isPlaced(c, pockets));
}

/**
 * Textsuche ueber die Exemplare, die in ein leeres Fach gelegt werden koennen. Dieselben Felder
 * wie die Sammlungssuche nach B1 Task 10 (Name, Set-Code, Tags, Notiz), zusaetzlich der Passcode
 * -- hier steht eine einzelne Karte vor dem Nutzer, nicht eine Gruppe, und der Passcode ist das,
 * was der Scanner liest. Tags kommen ueber parseTags, nie selbst zerlegt. `nameOf` liefert den
 * Kartennamen, der nicht am Exemplar, sondern an der Druckvariante haengt.
 */
export function filterCandidates(copies, query, nameOf) {
  const q = text(query).trim().toLowerCase();
  const all = list(copies);
  if (q === '') return all;
  const has = (v) => text(v).toLowerCase().includes(q);
  return all.filter((c) => has(nameOf?.(c))
    || has(c.set_code)
    || has(c.card_id)
    || parseTags(c.tags).some(has)
    || has(c.note));
}

/**
 * Das Auswahlangebot fuer ein leeres Fach, in zwei Gruppen. `looseCopies` sind die Exemplare
 * DIESES Behaelters ohne darstellbares Fach (`loose`), `unsortedCopies` die Exemplare ganz ohne
 * Behaelter (window.api.listUnsortedCopies). Beide durch dieselbe Textsuche.
 *
 * Warum zwei Gruppen: "Aus Fach nehmen" raeumt nur Seite und Fach, nicht den Behaelter -- der
 * Name der Aktion sagt "Fach". Das Exemplar liegt danach im Ordner, aber in keinem Fach, und
 * genau dieser Zwischenzustand muss wieder einlegbar sein. Beide Gruppen sind schnittfrei:
 * `loose` hat immer einen Behaelter, `unsorted` nie.
 *
 * Die Reihenfolge (`inContainer` zuerst) ist Teil der Rechnung, nicht Sache der Ansicht: wer eine
 * Seite dieses Ordners fuellt, meint eher eine Karte, die schon in diesem Ordner liegt.
 */
export function candidateGroups(looseCopies, unsortedCopies, query, nameOf) {
  return {
    inContainer: filterCandidates(looseCopies, query, nameOf),
    unsorted: filterCandidates(unsortedCopies, query, nameOf),
  };
}

/**
 * Kotlins SlotCandidates traegt isEmpty() als Methode; ein einfaches Objekt kann das nicht, also
 * steht die Regel hier als eigene Funktion -- damit die Ansicht nicht zweimal
 * `.inContainer.length === 0 && .unsorted.length === 0` hinschreibt.
 */
export function candidatesEmpty(groups) {
  return list(groups?.inContainer).length === 0 && list(groups?.unsorted).length === 0;
}
