// Spec B2: wohin ein Fach beim Blaettern vorrueckt (next), und wo im Ordner das erste freie Fach
// liegt (firstFree). Seiten und Faecher sind 1-basiert; pockets ist 4, 9 oder 12 (die drei
// Ordnergroessen dieses Projekts).
//
// Die Kotlin-Fassung derselben Regel steht in
// android/app/src/main/java/com/example/yugiohscanner/ml/SlotMath.kt.
// Dass es sie zweimal gibt, ist Absicht: das Handy braucht sie fuer den Einsortier-Modus, der
// Desktop fuer den Vorschlag im Exemplar-Sheet. Wer hier etwas aendert, aendert dort mit -- beide
// Testsuiten pruefen dieselben Faelle mit denselben Eingaben, bis auf die beiden unten
// genannten Abweichungen, die es in Kotlin nicht geben kann.
//
// Wirft nie: diese Funktionen werden aus Ansichten heraus gerufen, ein Absturz beim Blaettern
// waere schlimmer als eine schiefe Zahl. Zurechtrueckungen (in beiden Fassungen identisch):
// - pockets <= 0 wird auf 4 gezogen (die kleinste Ordnergroesse dieses Projekts).
// - page < 1 wird auf 1 gezogen, slot < 1 ebenso.
// - next: ein Fach, das die Seitengroesse ERREICHT ODER UEBERSCHREITET (nicht nur exakt trifft),
//   blaettert um -- so faengt ein Fach aus einer frueheren, groesseren Seitengroesse dieselbe
//   Umblaetterung wie ein regulaeres letztes Fach, statt eine Fachnummer jenseits der Seite
//   fortzuschreiben.
// - firstFree: ein belegtes Fach jenseits der aktuellen Seitengroesse (Rest einer frueheren,
//   groesseren Seitengroesse) zaehlt weder als belegt noch als vorhandene Seite -- es wird
//   vollstaendig ignoriert, so als gaebe es die Zeile nicht.
//
// Zwei Stellen sind NICHT identisch, weil der Renderer -- anders als Kotlin -- nichts typisiert:
// - Alle drei Clamps sowie die page/slot-Werte in firstFree laufen hier zusaetzlich durch
//   Number(...) + Math.trunc(...), bevor sie mit 0 verglichen werden. CustomSelect und <input>
//   liefern Zeichenketten ("4"), gelegentlich Bruchzahlen; ohne die Umwandlung wuerde eine
//   Zeichenkette per + verkettet statt addiert ("41" statt 5) und eine Bruchzahl unveraendert
//   durchgereicht. Kotlins Signatur (Int) kann beides nicht entgegennehmen.
// - firstFree behandelt ein nicht-Array occupied (undefined, null) wie ein leeres Array, statt zu
//   werfen. Kotlins Set<Pair<Int,Int>> ist nicht-nullbar und kennt diesen Fall nicht.

const toInt = (n) => Math.trunc(Number(n));
const clampPockets = (pockets) => (toInt(pockets) > 0 ? toInt(pockets) : 4);
const clampPage = (page) => (toInt(page) > 0 ? toInt(page) : 1);
const clampSlot = (slot) => (toInt(slot) > 0 ? toInt(slot) : 1);

export function next(page, slot, pockets) {
  const p = clampPockets(pockets);
  const pg = clampPage(page);
  const sl = clampSlot(slot);
  return sl >= p ? { page: pg + 1, slot: 1 } : { page: pg, slot: sl + 1 };
}

export function firstFree(occupied, pockets) {
  const p = clampPockets(pockets);
  const list = Array.isArray(occupied) ? occupied : [];
  // Kein Math.max(...arr) fuer highestPage: bei sehr vielen belegten Faechern sprengt das
  // Auseinanderziehen als Funktionsargumente die Aufrufstapel-Grenze der Engine -- ein Wurf, den
  // es laut Kopfkommentar nie geben darf und den Kotlins maxOf (kein Argument-Spread) nicht kennt.
  // Deshalb wird highestPage gleich in dieser Schleife mitgefuehrt statt hinterher aus den
  // Schluesseln zurueckgerechnet.
  const valid = new Set();
  let highestPage = 0;
  for (const o of list) {
    const pg = toInt(o.page);
    const sl = toInt(o.slot);
    if (pg >= 1 && sl >= 1 && sl <= p) {
      valid.add(`${pg},${sl}`);
      if (pg > highestPage) highestPage = pg;
    }
  }
  if (valid.size === 0) return { page: 1, slot: 1 };
  for (let pg = 1; pg <= highestPage; pg++) {
    for (let sl = 1; sl <= p; sl++) {
      if (!valid.has(`${pg},${sl}`)) return { page: pg, slot: sl };
    }
  }
  return { page: highestPage + 1, slot: 1 };
}
