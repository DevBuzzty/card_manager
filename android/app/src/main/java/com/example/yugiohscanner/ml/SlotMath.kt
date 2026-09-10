package com.example.yugiohscanner.ml

/**
 * Spec B2: wohin ein Fach beim Blaettern vorrueckt (`next`), und wo im Ordner das erste freie
 * Fach liegt (`firstFree`). Seiten und Faecher sind 1-basiert; `pockets` ist 4, 9 oder 12 (die
 * drei Ordnergroessen dieses Projekts).
 *
 * Die JavaScript-Fassung derselben Regel steht in `desktop/src/utils/slotMath.js`. Dass es sie
 * zweimal gibt, ist Absicht: das Handy braucht sie fuer den Einsortier-Modus, der Desktop fuer
 * den Vorschlag im Exemplar-Sheet. Wer hier etwas aendert, aendert dort mit -- beide Testsuiten
 * pruefen dieselben Faelle mit denselben Eingaben, bis auf die beiden unten genannten
 * Abweichungen, die es hier nicht geben kann.
 *
 * Wirft nie: diese Funktionen werden aus Ansichten heraus gerufen, ein Absturz beim Blaettern
 * waere schlimmer als eine schiefe Zahl. Zurechtrueckungen (in beiden Fassungen identisch):
 * - `pockets <= 0` wird auf 4 gezogen (die kleinste Ordnergroesse dieses Projekts).
 * - `page < 1` wird auf 1 gezogen, `slot < 1` ebenso.
 * - `next`: ein Fach, das die Seitengroesse ERREICHT ODER UEBERSCHREITET (nicht nur exakt trifft),
 *   blaettert um -- so faengt ein Fach aus einer frueheren, groesseren Seitengroesse dieselbe
 *   Umblaetterung wie ein regulaeres letztes Fach, statt eine Fachnummer jenseits der Seite
 *   fortzuschreiben.
 * - `firstFree`: ein belegtes Fach jenseits der aktuellen Seitengroesse (Rest einer frueheren,
 *   groesseren Seitengroesse) zaehlt weder als belegt noch als vorhandene Seite -- es wird
 *   vollstaendig ignoriert, so als gaebe es die Zeile nicht.
 *
 * Zwei Stellen sind NICHT identisch, weil der Renderer -- anders als Kotlin -- nichts
 * typisiert. Beide betreffen nur die JavaScript-Fassung; hier braucht es dafuer nichts, und
 * wer diese Datei anfasst, muss sie hier NICHT nachbauen:
 * - `slotMath.js` zieht Clamps und die page/slot-Werte in `firstFree` zusaetzlich durch
 *   Number(...) + Math.trunc(...). Dort liefern `CustomSelect` und `<input>` Zeichenketten
 *   und gelegentlich Bruchzahlen; die Signaturen hier (`Int`) koennen beides nicht
 *   entgegennehmen.
 * - `slotMath.js` behandelt ein nicht-Array `occupied` (undefined, null) wie ein leeres
 *   Array. `Set<Pair<Int, Int>>` ist nicht-nullbar und kennt diesen Fall nicht.
 */
object SlotMath {

    private fun clampPockets(pockets: Int): Int = if (pockets > 0) pockets else 4
    private fun clampPage(page: Int): Int = if (page > 0) page else 1
    private fun clampSlot(slot: Int): Int = if (slot > 0) slot else 1

    fun next(page: Int, slot: Int, pockets: Int): Pair<Int, Int> {
        val p = clampPockets(pockets)
        val pg = clampPage(page)
        val sl = clampSlot(slot)
        return if (sl >= p) (pg + 1) to 1 else pg to (sl + 1)
    }

    fun firstFree(occupied: Set<Pair<Int, Int>>, pockets: Int): Pair<Int, Int> {
        val p = clampPockets(pockets)
        val valid = occupied.filter { (pg, sl) -> pg >= 1 && sl in 1..p }.toSet()
        if (valid.isEmpty()) return 1 to 1
        val highestPage = valid.maxOf { it.first }
        for (pg in 1..highestPage) {
            for (sl in 1..p) {
                if ((pg to sl) !in valid) return pg to sl
            }
        }
        return (highestPage + 1) to 1
    }

    /**
     * Spec 5.3: die hoechste BELEGTE Seite eines Behaelters, null wenn keine Seite belegt ist --
     * gleiche Regel wie listContainers' max_page am Desktop (copies.cjs, dort per SQL MAX()).
     * Kein Zwilling: der Desktop bildet dieselbe Regel als Datenbankaggregat nach, nicht als
     * eigene JS-Funktion.
     */
    fun maxOccupiedPage(pages: Collection<Int?>): Int? = pages.filterNotNull().maxOrNull()
}
