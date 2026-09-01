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

    /** Feed one frame's detections; returns the detections that JUST reached confirmation. */
    fun update(dets: List<Detection>): List<Detection> {
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
                }
            }
        }
        return newlyConfirmed
    }

    /** Forget all state (used by the Reset/"Neu" button so the same cards can be re-scanned). */
    fun reset() {
        votes.clear(); misses.clear(); emitted.clear()
    }
}
