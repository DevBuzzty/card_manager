package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Spec B2 §7.2: die reinen Rechnungen hinter der Binder-Ansicht -- Rasterform, Seitenzahl, welches
 * Exemplar in welchem Fach einer Seite liegt, und die Textsuche ueber die einsortierbaren
 * Exemplare. Alles hier ist ohne Compose lauffaehig und wird in `BinderGridTest` geprueft; die
 * Ansicht (`ui/BinderPageScreen.kt`) trifft keine dieser Entscheidungen selbst.
 *
 * Die JavaScript-Fassung derselben Regeln steht in `desktop/src/utils/binderGrid.js` (geprueft in
 * `desktop/src/utils/binderGrid.test.js`). Dass es sie zweimal gibt, ist Absicht -- beide Geraete
 * zeigen denselben Ordner mit denselben Faechern. Wer hier etwas aendert, aendert dort mit; beide
 * Testsuiten pruefen dieselben Faelle mit denselben Eingaben, bis auf die Abweichungen, die der
 * Renderer braucht und die im Kopf von `binderGrid.js` stehen (Number/Math.trunc auf page/slot,
 * fehlende Listen und Textfelder wie leer behandelt). Es hier NICHT nachbauen: Kotlins Signaturen
 * koennen diese Faelle gar nicht entgegennehmen -- genau wie `SlotMath` und
 * `desktop/src/utils/slotMath.js` es vormachen.
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
     * Spec 5.3: die hoechste Seite, auf der ein Exemplar in einem DARSTELLBAREN Fach liegt, oder
     * null, wenn keines das tut. "Darstellbar" ist dasselbe `isPlaced` wie ueberall hier: Seite
     * >= 1 UND Fach in 1..Fachzahl. Genau daran haengt der Unterschied zu einem blossen MAX ueber
     * `page` -- ein Exemplar auf einem Fach jenseits der heutigen Ordnergroesse (der Ordner wurde
     * von 12 auf 9 Faecher umgestellt, das Exemplar steht auf S7/F11) zaehlt hier NICHT mit: das
     * Raster kann es nicht zeigen, `loose` fuehrt es unter "Ohne Fach". Wer es mitzaehlte,
     * verspraeche Seiten, die aufgeschlagen gar nicht existieren (Abschluss-Fixwelle, Minor 3).
     *
     * Zwilling ist hier NICHT `binderGrid.js`, sondern die Behaelterliste des Desktops, die
     * dieselbe Zahl per SQL rechnet (`copies.cjs`, listContainers' max_page). Beide muessen
     * dieselbe Regel treffen: hoechste Seite unter den Exemplaren, deren Fach innerhalb
     * 1..Fachzahl liegt.
     */
    fun maxPlacedPage(copies: List<CopyRow>, pockets: Int): Int? =
        SlotMath.maxOccupiedPage(copies.filter { isPlaced(it, pockets) }.map { it.page })

    /**
     * Spec 5.3: die hoechste BELEGTE Seite, nie `ceil(Anzahl / Faecher)`. Mindestens 1, damit ein
     * leerer Ordner eine (leere) erste Seite zum Blaettern hat.
     */
    fun pageCount(copies: List<CopyRow>, pockets: Int): Int = maxPlacedPage(copies, pockets) ?: 1

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

    /**
     * Das Auswahlangebot fuer ein leeres Fach, in zwei Gruppen. `inContainer` sind die Exemplare
     * DIESES Behaelters ohne darstellbares Fach (`loose`), `unsorted` die Exemplare ganz ohne
     * Behaelter (`UnsortedCopies.from`). Beide durch dieselbe Textsuche.
     *
     * Warum zwei Gruppen: "Aus Fach nehmen" raeumt nur Seite und Fach, nicht den Behaelter -- der
     * Name der Aktion sagt "Fach". Das Exemplar liegt danach im Ordner, aber in keinem Fach, und
     * genau dieser Zwischenzustand muss wieder einlegbar sein. Beide Gruppen sind schnittfrei:
     * `loose` hat immer einen Behaelter, `unsorted` nie.
     *
     * Die Reihenfolge (`inContainer` zuerst) ist Teil der Rechnung, nicht Sache der Ansicht: wer
     * eine Seite dieses Ordners fuellt, meint eher eine Karte, die schon in diesem Ordner liegt.
     */
    fun candidateGroups(
        loose: List<CopyRow>,
        unsorted: List<CopyRow>,
        query: String,
        nameOf: (CopyRow) -> String?,
    ): SlotCandidates = SlotCandidates(
        inContainer = filterCandidates(loose, query, nameOf),
        unsorted = filterCandidates(unsorted, query, nameOf),
    )

    /** Die beiden Gruppen des Auswahlangebots; `inContainer` steht in der Ansicht oben. */
    data class SlotCandidates(val inContainer: List<CopyRow>, val unsorted: List<CopyRow>) {
        fun isEmpty(): Boolean = inContainer.isEmpty() && unsorted.isEmpty()
    }
}
