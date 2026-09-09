// Spec B2: wohin ein Fach beim Blaettern vorrueckt (next), und wo im Ordner das erste freie Fach
// liegt (firstFree). Seiten und Faecher sind 1-basiert; pockets ist 4, 9 oder 12 (die drei
// Ordnergroessen dieses Projekts).
//
// Die Kotlin-Fassung derselben Regel steht in
// android/app/src/main/java/com/example/yugiohscanner/ml/SlotMath.kt.
// Dass es sie zweimal gibt, ist Absicht: das Handy braucht sie fuer den Einsortier-Modus, der
// Desktop fuer den Vorschlag im Exemplar-Sheet. Wer hier etwas aendert, aendert dort mit -- beide
// Testsuiten pruefen dieselben Faelle mit denselben Eingaben.
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

const clampPockets = (pockets) => (pockets > 0 ? pockets : 4);
const clampPage = (page) => (page > 0 ? page : 1);
const clampSlot = (slot) => (slot > 0 ? slot : 1);

export function next(page, slot, pockets) {
  const p = clampPockets(pockets);
  const pg = clampPage(page);
  const sl = clampSlot(slot);
  return sl >= p ? { page: pg + 1, slot: 1 } : { page: pg, slot: sl + 1 };
}

export function firstFree(occupied, pockets) {
  const p = clampPockets(pockets);
  const valid = new Set(
    occupied
      .filter((o) => o.page >= 1 && o.slot >= 1 && o.slot <= p)
      .map((o) => `${o.page},${o.slot}`),
  );
  if (valid.size === 0) return { page: 1, slot: 1 };
  // Kein Math.max(...arr): bei sehr vielen belegten Faechern sprengt das Auseinanderziehen als
  // Funktionsargumente die Aufrufstapel-Grenze der Engine -- ein Wurf, den es laut Kopfkommentar
  // nie geben darf und den Kotlins maxOf (kein Argument-Spread) nicht kennt.
  let highestPage = 0;
  for (const k of valid) {
    const pg = Number(k.split(',')[0]);
    if (pg > highestPage) highestPage = pg;
  }
  for (let pg = 1; pg <= highestPage; pg++) {
    for (let sl = 1; sl <= p; sl++) {
      if (!valid.has(`${pg},${sl}`)) return { page: pg, slot: sl };
    }
  }
  return { page: highestPage + 1, slot: 1 };
}
