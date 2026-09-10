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
 * Der ganze Sitzungszustand ausser der Warteschlange. `copies` ist die Arbeitskopie der lebenden
 * Exemplare: sie wandert bei jeder Zuweisung mit, damit ein zweiter Scan derselben Karte nicht
 * dasselbe Exemplar noch einmal anbietet. Die Wahrheit bleibt der Server -- die Binder-Ansicht
 * laedt nach dem Verlassen neu.
 */
data class SortState(
    val page: Int,
    val slot: Int,
    val placed: List<Placement>,
    val copies: List<CopyRow>,
)

object SortSession {

    /** Startvorschlag: das erste freie Fach dieses Behaelters (Spec §6.1). */
    fun start(copies: List<CopyRow>, containerId: String, pockets: Int): SortState {
        val occupied = copies
            .filter { it.containerId == containerId && BinderGrid.isPlaced(it, pockets) }
            .map { it.page!! to it.slot!! }
            .toSet()
        val (page, slot) = SlotMath.firstFree(occupied, pockets)
        return SortState(page = page, slot = slot, placed = emptyList(), copies = copies)
    }

    /**
     * Der vom Nutzer im Start-Sheet eingetippte Startpunkt, zurechtgerueckt. Eigene Regel, kein
     * Nachbau: `SlotMath.next`/`firstFree` bekommen nie eine Eingabe von Hand. Die Fachzahl selbst
     * kommt aus `SlotMath.clampPockets`, damit ein Ordner ohne (oder mit unsinniger) Fachzahl auch
     * hier als 4er-Ordner zaehlt.
     */
    fun startAt(page: Int, slot: Int, pockets: Int): Pair<Int, Int> {
        val p = SlotMath.clampPockets(pockets)
        return page.coerceAtLeast(1) to slot.coerceIn(1, p)
    }

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
            placed = state.placed + placement,
            copies = state.copies.map {
                if (it.copyId == copyId) it.copy(containerId = containerId, page = placement.page, slot = placement.slot)
                else it
            },
        )
        return next to placement
    }

    /**
     * Nimmt die zuletzt erfolgte Zuweisung zurueck: das Exemplar bekommt seinen vorherigen
     * Standort, das Fach springt auf das der zurueckgenommenen Karte. Es wird NICHT
     * zurueckgerechnet (kein `prev(page, slot)`) -- die Zuweisung weiss selbst, wo sie hinging.
     * null, wenn der Stapel leer ist. Die Tiefe ist die ganze Sitzung (Spec §6.5).
     */
    fun undo(state: SortState): Pair<SortState, Placement>? {
        val placement = state.placed.lastOrNull() ?: return null
        val next = state.copy(
            page = placement.page,
            slot = placement.slot,
            // dropLast statt remove: `placed` ist ein Stapel, es geht immer das letzte Element --
            // und Placement vergleicht ueber Identitaet, `remove` wuerde dasselbe treffen.
            placed = state.placed.dropLast(1),
            copies = state.copies.map {
                if (it.copyId == placement.copyId) it.copy(
                    containerId = placement.vorherContainerId,
                    page = placement.vorherPage,
                    slot = placement.vorherSlot,
                ) else it
            },
        )
        return next to placement
    }

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
