package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Spec B2 §6: die reinen Rechnungen des Einsortier-Modus -- Startvorschlag, Vorruecken,
 * Rueckgaengig-Stapel und die Warteschlange fuer Zuweisungen, die das Netz nicht angenommen hat.
 * Ohne Compose lauffaehig und in `SortSessionTest` geprueft; `ui/SortIntoBinderScreen.kt` zeigt
 * nur an und ruft hier hinein.
 *
 * Keine Regel wird hier zweimal geschrieben:
 * - Wohin das Fach vorrueckt und wo das erste freie Fach liegt, kommt aus `SlotMath`.
 * - Ob ein Exemplar in einem darstellbaren Fach liegt, kommt aus `BinderGrid.isPlaced`.
 * - Ob Seite und Fach ueberhaupt in die Datenbank gehen, entscheidet
 *   `CollectionRepository.setCopyLocation` -- hier wird nichts darueber angenommen.
 *
 * Kein Zwilling: der Desktop hat keinen Einsortier-Modus (Spec B §3, Nicht-Ziele).
 */

/**
 * Eine erfolgte Zuweisung. Der Rueckgaengig-Stapel haelt diese OBJEKTE und vergleicht sie mit
 * `===`, niemals ueber ihre Position in einer Liste: in Spec D4 hat genau ein aufgehobener Index
 * die falsche Karte heruntergezaehlt, weil die Liste sich zwischen Buchen und Ruecknahme
 * veraendert hatte. Deshalb ist das hier bewusst KEINE `data class` -- Gleichheit ist Identitaet,
 * zwei inhaltsgleiche Zuweisungen bleiben zwei verschiedene Dinge.
 *
 * `vorher*` ist der Standort, an dem das Exemplar VOR der Zuweisung lag; Rueckgaengig schreibt
 * genau diese drei Werte zurueck. Im einfachen Fall (Task 6) sind sie alle null -- `PickCandidate`
 * bietet nur nicht einsortierte Exemplare an --, aber die Ruecknahme darf das nicht annehmen:
 * Task 7 verschiebt auch bereits einsortierte Exemplare hierher.
 */
class Placement(
    val copyId: String,
    val cardId: String,
    val containerId: String,
    val page: Int,
    val slot: Int,
    val vorherContainerId: String?,
    val vorherPage: Int?,
    val vorherSlot: Int?,
) {
    override fun toString(): String = "Placement($copyId -> S$page/F$slot)"
}

/**
 * Eine Zuweisung, die das Netz nicht angenommen hat. `zurueck = false` heisst "schreibe
 * containerId/page/slot", `zurueck = true` heisst "schreibe vorherContainerId/vorherPage/
 * vorherSlot" (eine Ruecknahme, die selbst nicht durchkam).
 */
class PendingWrite(val placement: Placement, val zurueck: Boolean)

/**
 * Ein Schritt der Sitzung, so wie Rueckgaengig ihn wieder abtraegt. Es gibt ZWEI Arten, weil der
 * Modus auf zwei Wegen ein Fach fuellen und vorruecken kann (Spec §6.3):
 * - [Zugewiesen]: ein Exemplar der Sammlung hat einen Standort bekommen.
 * - [Reserviert]: die Karte ist gar nicht in der Sammlung. Sie geht ins Handy-Staging und merkt
 *   sich dort das Fach (Task 5); das Fach rueckt trotzdem vor, denn die Karte liegt physisch
 *   schon drin. Es gibt hier kein Exemplar und keinen Standort, den man zurueckschreiben koennte.
 *
 * Beide stehen im SELBEN Stapel, und das ist der ganze Punkt: laege die Reservierung daneben,
 * spraenge Rueckgaengig ueber sie hinweg und naehme die davorliegende Zuweisung zurueck -- also
 * eine Karte, die der Nutzer gar nicht gemeint hat (derselbe Fehler wie der aufgehobene Index in
 * Spec D4). Wie [Placement] sind beide bewusst KEINE `data class`: Gleichheit ist Identitaet.
 *
 * [Reserviert.marke] ist der Staging-Eintrag, den die Oberflaeche angelegt hat -- hier absichtlich
 * als undurchsichtige Marke gehalten, damit diese Rechenschicht nicht von einem Compose-Typ
 * abhaengt. Sie kommt bei der Ruecknahme unveraendert zurueck; verglichen wird dort mit `===`.
 */
sealed interface Schritt {
    val page: Int
    val slot: Int

    class Zugewiesen(val placement: Placement) : Schritt {
        override val page: Int get() = placement.page
        override val slot: Int get() = placement.slot
    }

    class Reserviert(override val page: Int, override val slot: Int, val marke: Any?) : Schritt
}

/** Was [SortSession.undo] zurueckgibt: eine Zuweisung will geschrieben werden, eine Reservierung
 *  nicht -- bei ihr raeumt die Oberflaeche nur ihren Staging-Eintrag ([marke]) wieder weg. */
sealed interface Ruecknahme {
    class Zuweisung(val placement: Placement) : Ruecknahme
    class Reservierung(val marke: Any?) : Ruecknahme
}

/**
 * Der ganze Sitzungszustand ausser der Warteschlange. `copies` ist die Arbeitskopie der lebenden
 * Exemplare: sie wandert bei jeder Zuweisung mit, damit ein zweiter Scan derselben Karte nicht
 * dasselbe Exemplar noch einmal anbietet. Die Wahrheit bleibt der Server -- die Binder-Ansicht
 * laedt nach dem Verlassen neu.
 */
data class SortState(
    val page: Int,
    val slot: Int,
    val schritte: List<Schritt>,
    val copies: List<CopyRow>,
)

object SortSession {

    /**
     * Obergrenze fuer eine von Hand eingetippte Seite. Kein Ordner dieser Welt hat 1000 Seiten;
     * ein Vertipper ("9999" statt "999") wuerde die naechste Karte dorthin einsortieren und die
     * Binder-Ansicht danach einen Pager ueber 9999 Seiten aufbauen, durch den der Nutzer sich
     * zurueckblaettern darf. Die Grenze wohnt hier und nicht im Textfeld -- das Textfeld begrenzt
     * nur die Zeichenzahl, die Regel ist eine Rechnung.
     */
    const val MAX_PAGE = 999

    /** Startvorschlag: das erste freie Fach dieses Behaelters (Spec §6.1). */
    fun start(copies: List<CopyRow>, containerId: String, pockets: Int): SortState {
        val occupied = copies
            .filter { it.containerId == containerId && BinderGrid.isPlaced(it, pockets) }
            .map { it.page!! to it.slot!! }
            .toSet()
        val (page, slot) = SlotMath.firstFree(occupied, pockets)
        return SortState(page = page, slot = slot, schritte = emptyList(), copies = copies)
    }

    /**
     * Der vom Nutzer im Start-Sheet eingetippte Startpunkt, zurechtgerueckt. Eigene Regel, kein
     * Nachbau: `SlotMath.next`/`firstFree` bekommen nie eine Eingabe von Hand. Die Fachzahl selbst
     * kommt aus `SlotMath.clampPockets`, damit ein Ordner ohne (oder mit unsinniger) Fachzahl auch
     * hier als 4er-Ordner zaehlt. Die Seite wird nach unten auf 1 und nach oben auf [MAX_PAGE]
     * gezogen, das Fach auf das letzte der Seite.
     */
    fun startAt(page: Int, slot: Int, pockets: Int): Pair<Int, Int> {
        val p = SlotMath.clampPockets(pockets)
        return page.coerceIn(1, MAX_PAGE) to slot.coerceIn(1, p)
    }

    /**
     * Die Seite, auf der die Binder-Ansicht nach dem Verlassen aufschlaegt (Spec §6.6): die der
     * zuletzt eingelegten Karte, sonst das Fach, auf dem der Modus gerade steht. Steht hier und
     * nicht in der Oberflaeche, weil sie dort an zwei Stellen gebraucht wird -- eine Regel, zwei
     * Abschriften ist genau der Fehler aus Spec B1.
     */
    fun lastPage(state: SortState?): Int =
        state?.let { it.schritte.lastOrNull()?.page ?: it.page } ?: 1

    /**
     * Die Kandidaten aus `PickCandidate.Many`, aufgeloest zu Zeilen -- IN DER GELIEFERTEN
     * REIHENFOLGE (Standard-Exemplare zuerst, innerhalb der Gruppen stabil). `PickCandidate` hat
     * sie schon geordnet; ein `copies.filter { it.copyId in ids }` wuerde sie stillschweigend in
     * die Reihenfolge der Arbeitskopie zurueckdrehen und die Vorauswahl zunichtemachen. Ids ohne
     * Zeile fallen weg (das Exemplar ist zwischenzeitlich verschwunden), statt zu werfen.
     */
    fun chosen(copies: List<CopyRow>, copyIds: List<String>): List<CopyRow> =
        copyIds.mapNotNull { id -> copies.find { it.copyId == id } }

    /**
     * Die einsortierten Exemplare dieses Passcodes -- der Fall `PickCandidate.AllPlaced`: die
     * Oberflaeche nennt ihre Standorte im Sheet, und das ERSTE ist das, welches "eines hierher
     * verschieben" bewegt. Reihenfolge der Arbeitskopie; sie ist stabil, solange keine Zuweisung
     * dazwischenkommt, und der Modus ist waehrend eines offenen Sheets ohnehin verriegelt.
     */
    fun placedCandidates(copies: List<CopyRow>, passcode: String): List<CopyRow> =
        copies.filter { !it.deleted && it.cardId == passcode && it.containerId != null }

    /**
     * Weist das Exemplar dem aktuellen Fach zu und rueckt vor. Gibt den neuen Zustand und die
     * angelegte [Placement] zurueck -- oder null, wenn `copyId` gar nicht (mehr) in der
     * Arbeitskopie steht. Wirft nie: der Modus laeuft weiter, der Aufrufer meldet den Fall.
     */
    fun assign(state: SortState, copyId: String, containerId: String, pockets: Int): Pair<SortState, Placement>? {
        val copy = state.copies.find { it.copyId == copyId } ?: return null
        val placement = Placement(
            copyId = copy.copyId,
            cardId = copy.cardId,
            containerId = containerId,
            page = state.page,
            slot = state.slot,
            vorherContainerId = copy.containerId,
            vorherPage = copy.page,
            vorherSlot = copy.slot,
        )
        val (nextPage, nextSlot) = SlotMath.next(state.page, state.slot, pockets)
        val next = state.copy(
            page = nextPage,
            slot = nextSlot,
            schritte = state.schritte + Schritt.Zugewiesen(placement),
            copies = state.copies.map {
                if (it.copyId == copyId) it.copy(containerId = containerId, page = placement.page, slot = placement.slot)
                else it
            },
        )
        return next to placement
    }

    /**
     * Das Fach rueckt vor, OHNE dass ein Exemplar zugewiesen wird: die Karte ist nicht in der
     * Sammlung und geht ins Handy-Staging, liegt physisch aber schon im Fach (Spec §6.3, Nachtrag
     * §2). [marke] ist der Staging-Eintrag der Oberflaeche, den Rueckgaengig spaeter wieder
     * wegraeumen soll. Der zurueckgegebene [Schritt.Reserviert] traegt das Fach, fuer das
     * reserviert wurde -- die Oberflaeche muss es nicht selbst noch einmal ablesen.
     */
    fun reserve(state: SortState, pockets: Int, marke: Any?): Pair<SortState, Schritt.Reserviert> {
        val schritt = Schritt.Reserviert(state.page, state.slot, marke)
        val (nextPage, nextSlot) = SlotMath.next(state.page, state.slot, pockets)
        return state.copy(page = nextPage, slot = nextSlot, schritte = state.schritte + schritt) to schritt
    }

    /**
     * Nimmt den zuletzt erfolgten Schritt zurueck. Bei einer Zuweisung bekommt das Exemplar seinen
     * vorherigen Standort; bei einer Reservierung gibt es nichts zurueckzuschreiben, die
     * Oberflaeche entfernt nur ihren Staging-Eintrag. In beiden Faellen springt das Fach auf das
     * des zurueckgenommenen Schrittes. Es wird NICHT zurueckgerechnet (kein `prev(page, slot)`) --
     * der Schritt weiss selbst, wo er hinging. null, wenn der Stapel leer ist. Die Tiefe ist die
     * ganze Sitzung (Spec §6.5).
     */
    fun undo(state: SortState): Pair<SortState, Ruecknahme>? {
        val schritt = state.schritte.lastOrNull() ?: return null
        val basis = state.copy(
            page = schritt.page,
            slot = schritt.slot,
            // dropLast statt remove: `schritte` ist ein Stapel, es geht immer das letzte Element --
            // und Schritt vergleicht ueber Identitaet, `remove` wuerde dasselbe treffen.
            schritte = state.schritte.dropLast(1),
        )
        return when (schritt) {
            is Schritt.Zugewiesen -> {
                val p = schritt.placement
                basis.copy(
                    copies = state.copies.map {
                        if (it.copyId == p.copyId) it.copy(
                            containerId = p.vorherContainerId,
                            page = p.vorherPage,
                            slot = p.vorherSlot,
                        ) else it
                    },
                ) to Ruecknahme.Zuweisung(p)
            }
            is Schritt.Reserviert -> basis to Ruecknahme.Reservierung(schritt.marke)
        }
    }

    /**
     * Nimmt den letzten Schritt vom Stapel, OHNE etwas zurueckzudrehen -- Fach und Arbeitskopie
     * bleiben, wo sie sind. Genau ein Fall braucht das: eine Reservierung, deren Staging-Eintrag
     * der Nutzer inzwischen uebernommen hat. Die Karte sitzt dann bereits mit Standort in der
     * Sammlung; das Fach zurueckspringen zu lassen wuerde die naechste Karte auf ein belegtes Fach
     * setzen, und der Schritt einfach liegenzulassen wuerde jedes weitere Rueckgaengig auf ihm
     * haengenbleiben lassen.
     */
    fun dropStep(state: SortState): SortState = state.copy(schritte = state.schritte.dropLast(1))

    /** Eine gescheiterte Schreibung wandert ans Ende der Warteschlange. */
    fun enqueue(queue: List<PendingWrite>, placement: Placement, zurueck: Boolean): List<PendingWrite> =
        queue + PendingWrite(placement, zurueck)

    /** Nach erfolgreicher Schreibung: genau DIESEN Eintrag entfernen, ueber Identitaet. */
    fun settled(queue: List<PendingWrite>, pending: PendingWrite): List<PendingWrite> =
        queue.filterNot { it === pending }

    /**
     * Rueckgaengig trifft auf die Warteschlange: steht die urspruengliche Zuweisung noch
     * ungeschrieben darin, heben sich beide auf -- der Eintrag faellt weg und es muss NICHTS
     * geschrieben werden. War sie schon geschrieben, muss der vorherige Standort zurueck.
     * Gibt die neue Warteschlange und zurueck, ob geschrieben werden muss.
     */
    fun cancelPending(queue: List<PendingWrite>, placement: Placement): Pair<List<PendingWrite>, Boolean> {
        val offen = queue.any { it.placement === placement && !it.zurueck }
        if (!offen) return queue to true
        return queue.filterNot { it.placement === placement && !it.zurueck } to false
    }

    /**
     * Was beim Verlassen verlorengeht, in Worten -- eine Zeile je Eintrag. Der Modus zeigt sie
     * ausdruecklich an, statt sie still zu verwerfen: eine verworfene Zuweisung ist kein Verlust
     * einer Karte (das Exemplar bleibt in der Sammlung und liegt danach unter "Nicht einsortiert",
     * jederzeit wiederherstellbar), aber die physische Ablage des Nutzers ist der Datenbank dann
     * voraus -- und nur er kann das wieder zusammenbringen.
     */
    fun lossDescriptions(queue: List<PendingWrite>): List<String> = queue.map {
        if (it.zurueck) "Rückgängig (Seite ${it.placement.page} · Fach ${it.placement.slot})"
        else "Seite ${it.placement.page} · Fach ${it.placement.slot}"
    }
}
