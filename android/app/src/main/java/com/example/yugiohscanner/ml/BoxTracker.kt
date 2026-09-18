package com.example.yugiohscanner.ml

/**
 * Confirms a card once its passcode has been seen in [need] recent frames. Tracking is
 * per-PASSCODE (not per box position), so a new card that appears where a previous one just
 * was still confirms on its own — the earlier fix tracked by IoU, which let a lingering
 * confirmed box "swallow" the next card at the same spot.
 *
 * A passcode is emitted once per presence; after it's been gone for [maxMisses] frames it's
 * forgotten, so re-showing the same card can confirm it again. (Global "stage once" dedup is
 * handled by the caller's `seen` set.)
 */
class BoxTracker(private val need: Int = 2, private val maxMisses: Int = 8) {

    private val votes = HashMap<Int, Int>()
    private val misses = HashMap<Int, Int>()
    private val emitted = HashSet<Int>()

    /**
     * Fix Runde 1 (Review von 3c5f3f6, Kritisch #2): Zeitpunkt, zu dem jeder aktuell emittierte
     * Passcode bestaetigt wurde. Gebraucht von [rearm], um eine Karte, die WAEHREND der Unruhe
     * bestaetigt wurde, die diese Meldung ausgeloest hat, von genau dieser Meldung auszunehmen --
     * siehe [rearm]s eigenen Kommentar.
     */
    private val confirmedAt = HashMap<Int, Long>()

    /** Passcodes, die [update] im letzten Aufruf endgueltig verworfen hat (Karte ist aus dem Bild).
     *  Wird bei jedem [update] neu befuellt; der Aufrufer raeumt daraufhin seine eigenen Belege ab. */
    val droppedThisFrame = ArrayList<Int>()

    /**
     * Feed one frame's detections; returns the detections that JUST reached confirmation.
     * [tMs] ist der Zeitstempel dieses Bildes -- als Default `System.currentTimeMillis()` fuer
     * Aufrufer, die keine eigene Uhr mitfuehren (z. B. SortIntoBinderScreen); ScanScreen (Modus
     * "stapel") reicht denselben Zeitstempel durch, den es auch fuer die Einwurf-Erkennung benutzt, damit
     * [rearm]s Unruhe-Vergleich auf derselben Uhr beruht.
     */
    fun update(dets: List<Detection>, tMs: Long = System.currentTimeMillis()): List<Detection> {
        droppedThisFrame.clear()
        val newlyConfirmed = ArrayList<Detection>()
        val present = HashSet<Int>()

        for (d in dets) {
            if (d.passcode < 0) continue           // "not read this frame" — ignore
            present.add(d.passcode)
            misses[d.passcode] = 0
            if (d.passcode in emitted) continue    // already captured while still in view
            val c = (votes[d.passcode] ?: 0) + 1
            votes[d.passcode] = c
            if (c >= need) {
                emitted.add(d.passcode)
                votes.remove(d.passcode)
                confirmedAt[d.passcode] = tMs
                newlyConfirmed.add(d)
            }
        }

        // Age passcodes not seen this frame; forget them after maxMisses so a card that leaves
        // and comes back can confirm again.
        for (pc in (votes.keys + emitted).toList()) {
            if (pc !in present) {
                val m = (misses[pc] ?: 0) + 1
                misses[pc] = m
                if (m > maxMisses) {
                    votes.remove(pc); emitted.remove(pc); misses.remove(pc); confirmedAt.remove(pc)
                    // Merken, wer gerade endgueltig aus dem Bild ist. Seit Spec D3 Task 6 raeumt
                    // ScanScreen die Belege einer Karte nicht mehr bei der Bestaetigung ab -- die
                    // stille Verbesserung braucht sie ja noch. Ohne diese Meldung waechst
                    // SetCodeEvidence dann unbegrenzt weiter, und D4 schiebt Hunderte Karten
                    // durch eine Sitzung. Hier ist der einzige Ort, der weiss, dass eine Karte
                    // nicht bloss kurz verdeckt, sondern weg ist.
                    droppedThisFrame.add(pc)
                }
            }
        }
        return newlyConfirmed
    }

    /** Forget all state (used by the Reset/"Neu" button so the same cards can be re-scanned). */
    fun reset() {
        votes.clear(); misses.clear(); emitted.clear(); confirmedAt.clear(); droppedThisFrame.clear()
    }

    /**
     * Stapel-Scan-Fix: entfernt die bereits BESTAETIGTEN unter [passcodes] aus `emitted` und
     * setzt ihre `votes` zurueck, sodass eine noch anwesende Karte nach zwei weiteren Treffern (hoechstens [need])
     * erneut bestaetigt. Fuer den Stapel-Scan (siehe
     * docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/brief.md): eine zweite gleiche
     * Karte, die auf die erste rutscht, aendert nie den Passcode im Bild, also faellt sie nie
     * unter maxMisses und wuerde ohne rearm nie ein zweites Mal gemeldet.
     *
     * Fix Runde 1 (Review von 3c5f3f6, Kritisch): [passcodes] enthaelt ALLE aktuell im Bild
     * erkannten Passcodes, nicht nur bestaetigte -- eine Karte, die gerade erst ihre [need]-te
     * Stimme bekommen wuerde, war vorher NICHT bestaetigt, aber ebenfalls in [passcodes] (siehe
     * Karte 1 in messung-1.txt: StackMotion meldet im selben Bild, in dem die vierte Stimme
     * faellig ist). Ein bedingungsloses `votes.remove` hier hat diese Stimme geloescht und die
     * erste Bestaetigung um mehrere Bilder verzoegert oder ganz verschluckt. Nur Passcodes, die
     * bereits in `emitted` stehen, werden also zurueckgesetzt; eine noch nicht bestaetigte Karte
     * bleibt von rearm unberuehrt. `misses` bleibt ebenfalls unangetastet -- rearm aendert nur,
     * ob/wie eine anwesende Karte erneut bestaetigt, nicht wann eine abwesende vergessen wird.
     *
     * Fix Runde 1 (Review von 3c5f3f6, Kritisch #2): [unrestStartMs] ist der Beginn der Unruhe,
     * die genau diese Meldung ausgeloest hat (heute: Beginn des Einwurfs, [ChuteGate.Burst.startMs]). Eine
     * Karte, die WAEHREND dieser Unruhe erst bestaetigt wurde -- also z. B. die einzige Karte, die
     * gerade neu in ein leeres Fach faellt, deren eigenes Einfallen die Unruhe UND ihre eigene
     * vierte Stimme ausloest --, ist keine zweite, eingerutschte Kopie, sondern dieselbe Ankunft.
     * Nur Passcodes mit `confirmedAt < unrestStartMs` werden also tatsaechlich rearmt; siehe
     * messung-2-roh.log 11:50:00.267-01.639 (Bestaetigung 01.163, Meldung erst 01.639 fuer
     * dieselbe Unruhe ab 00.267 -- ohne diese Schranke haette rearm die frisch bestaetigte Karte
     * sofort wieder zurueckgesetzt und sie ein zweites Mal, faelschlich, bestaetigt).
     *
     * @return die Teilmenge von [passcodes], die tatsaechlich zurueckgesetzt wurde (d. h. vorher
     *   bestaetigt war UND vor [unrestStartMs] bestaetigt wurde) -- der Aufrufer braucht das, um
     *   zugehoerige Belege (z. B. SetCodeEvidence) nur fuer wirklich rearmte Karten zu vergessen.
     */
    /**
     * Stapel-Lichtschranke, Abnahme 1 (docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/
     * abnahme-1-roh.log): wie [rearm], aber fuer ALLE bestaetigten Passcodes -- nicht nur die im
     * Einwurf-Bild erkannten. Waehrend die Karte einrutscht, ist oft gar keine erkannt; rearm mit den
     * Erkennungen dieses Bildes setzte dann nichts zurueck, die liegende Karte bestaetigte nie erneut
     * und der Einwurf blieb offen, bis ein spaeterer ihn mitnahm (Zaehler sprang) oder er verfiel.
     */
    fun rearmAll(unrestStartMs: Long): Set<Int> = rearm(confirmedAt.keys.toList(), unrestStartMs)

    fun rearm(passcodes: Collection<Int>, unrestStartMs: Long): Set<Int> {
        val rearmed = HashSet<Int>()
        for (pc in passcodes) {
            // Kritisch #1: `confirmedAt` hat nur fuer bereits BESTAETIGTE (emittierte) Passcodes
            // einen Eintrag (siehe update()/reset() -- beide Maps bleiben im Gleichschritt), ein
            // fehlender Eintrag schliesst eine noch nicht bestaetigte Karte also automatisch aus.
            val at = confirmedAt[pc] ?: continue
            // Kritisch #2: nur rearmen, wenn diese Bestaetigung VOR der aktuellen Unruhe lag.
            if (at >= unrestStartMs) continue
            emitted.remove(pc)
            // Die Karte ist schon identifiziert (gleicher Passcode): EINE frische Sichtung nach dem
            // Einwurf reicht (18.09., mit Detektor v2 sind die Sichtungen verlaesslich) -- jede
            // weitere haette ~0,25 s Verzoegerung bis zum +1 bedeutet.
            if (need > 1) votes[pc] = need - 1 else votes.remove(pc)
            confirmedAt.remove(pc)
            rearmed.add(pc)
        }
        return rearmed
    }
}
