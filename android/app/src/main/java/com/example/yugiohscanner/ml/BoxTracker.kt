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

    /** Passcodes, die [update] im letzten Aufruf endgueltig verworfen hat (Karte ist aus dem Bild).
     *  Wird bei jedem [update] neu befuellt; der Aufrufer raeumt daraufhin seine eigenen Belege ab. */
    val droppedThisFrame = ArrayList<Int>()

    /** Feed one frame's detections; returns the detections that JUST reached confirmation. */
    fun update(dets: List<Detection>): List<Detection> {
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
                    votes.remove(pc); emitted.remove(pc); misses.remove(pc)
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
        votes.clear(); misses.clear(); emitted.clear(); droppedThisFrame.clear()
    }

    /**
     * Stapel-Scan-Fix: entfernt [passcodes] aus `emitted` und setzt ihre `votes` zurueck, sodass
     * eine noch anwesende Karte mit denselben [need] Treffern erneut bestaetigt. Fuer StackMotion
     * (siehe docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/brief.md): eine zweite
     * gleiche Karte, die auf die erste rutscht, aendert nie den Passcode im Bild, also faellt sie
     * nie unter maxMisses und wuerde ohne rearm nie ein zweites Mal gemeldet. `misses` bleibt
     * unangetastet -- rearm aendert nur, ob/wie eine anwesende Karte erneut bestaetigt, nicht wann
     * eine abwesende vergessen wird.
     */
    fun rearm(passcodes: Collection<Int>) {
        for (pc in passcodes) {
            emitted.remove(pc)
            votes.remove(pc)
        }
    }
}
