package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Spec B2 §7.2: die reinen Rechnungen hinter der Binder-Ansicht -- Rasterform, Seitenzahl, welches
 * Exemplar in welchem Fach einer Seite liegt, und die Textsuche ueber die einsortierbaren
 * Exemplare. Alles hier ist ohne Compose lauffaehig und wird in `BinderGridTest` geprueft; die
 * Ansicht (`ui/BinderPageScreen.kt`) trifft keine dieser Entscheidungen selbst.
 *
 * Kein Zwilling: eine JavaScript-Fassung dieser Regeln gibt es im Baum noch nicht (der Desktop
 * zeigt bislang kein Raster). Kommt eine dazu, gehoert sie hier vermerkt und muss dieselben
 * Faelle abdecken -- so wie `SlotMath` es mit `desktop/src/utils/slotMath.js` vormacht.
 *
 * Die Zurechtrueckung von `pockets` kommt aus `SlotMath.clampPockets` und wird hier NICHT
 * nachgebaut: ein Ordner ohne (oder mit unsinniger) Fachzahl zaehlt in der ganzen App als
 * 4er-Ordner, an genau einer Stelle entschieden.
 *
 * Der Begriff "belegt" ist hier derselbe wie in `SlotMath.firstFree`: ein Exemplar mit einem Fach
 * JENSEITS der aktuellen Seitengroesse (Rest einer frueheren, groesseren Ordnergroesse) gilt NICHT
 * als einsortiert. Das ist wichtig, weil es sonst unsichtbar waere -- kein Fach des Rasters kann es
 * zeigen. Solche Exemplare liefert `loose` zurueck, damit die Ansicht sie neben dem Raster auffuehrt.
 */
object BinderGrid {

    /** 4 Faecher -> 2 Spalten (2x2), 9 -> 3 (3x3), 12 -> 3 (3x4). */
    fun columns(pockets: Int): Int = if (SlotMath.clampPockets(pockets) <= 4) 2 else 3

    /** Liegt dieses Exemplar in einem Fach, das das Raster dieser Ordnergroesse zeigen kann? */
    fun isPlaced(copy: CopyRow, pockets: Int): Boolean {
        val page = copy.page ?: return false
        val slot = copy.slot ?: return false
        return page >= 1 && slot in 1..SlotMath.clampPockets(pockets)
    }

    /**
     * Spec 5.3: die hoechste BELEGTE Seite, nie `ceil(Anzahl / Faecher)`. Mindestens 1, damit ein
     * leerer Ordner eine (leere) erste Seite zum Blaettern hat.
     */
    fun pageCount(copies: List<CopyRow>, pockets: Int): Int =
        SlotMath.maxOccupiedPage(copies.filter { isPlaced(it, pockets) }.map { it.page }) ?: 1

    /**
     * Die Faecher EINER Seite, von Fach 1 an: Ergebnis[i] sind die Exemplare in Fach i+1. Die
     * Liste ist immer genau `pockets` lang (leere Faecher sind leere Listen), und mehrere
     * Exemplare im selben Fach bleiben in Eingabereihenfolge stehen -- daran haengt das
     * Mengen-Abzeichen.
     */
    fun slots(copies: List<CopyRow>, page: Int, pockets: Int): List<List<CopyRow>> {
        val p = SlotMath.clampPockets(pockets)
        val onPage = copies.filter { isPlaced(it, p) && it.page == page }
        return (1..p).map { slot -> onPage.filter { it.slot == slot } }
    }

    /** Exemplare des Behaelters, die kein anzeigbares Fach haben -- Box/Deckbox komplett. */
    fun loose(copies: List<CopyRow>, pockets: Int): List<CopyRow> =
        copies.filterNot { isPlaced(it, pockets) }

    /**
     * Textsuche ueber die Exemplare, die in ein leeres Fach gelegt werden koennen. Dieselben
     * Felder wie die Sammlungssuche nach B1 Task 10 (Name, Set-Code, Tags, Notiz), zusaetzlich der
     * Passcode -- hier steht eine einzelne Karte vor dem Nutzer, nicht eine Gruppe, und der
     * Passcode ist das, was der Scanner liest. Tags kommen ueber `Tags.parse`, nie selbst zerlegt.
     * `nameOf` liefert den Kartennamen, der nicht am Exemplar, sondern an der Druckvariante haengt.
     */
    fun filterCandidates(copies: List<CopyRow>, query: String, nameOf: (CopyRow) -> String?): List<CopyRow> {
        val q = query.trim()
        if (q.isEmpty()) return copies
        return copies.filter { c ->
            nameOf(c)?.contains(q, ignoreCase = true) == true ||
                c.setCode.contains(q, ignoreCase = true) ||
                c.cardId.contains(q, ignoreCase = true) ||
                Tags.parse(c.tags).any { it.contains(q, ignoreCase = true) } ||
                c.note?.contains(q, ignoreCase = true) == true
        }
    }
}
