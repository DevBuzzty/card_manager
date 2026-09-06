package com.example.yugiohscanner.ml

/**
 * Multi-frame set-code voting. The set code is tiny print and any single frame may be blurred,
 * glared, or partly cut off, so we accumulate each card's OCR text across the frames it's visible
 * (keyed by passcode) and resolve it from all of them at once. Downstream, SetCodeMatch matches
 * this pooled evidence against the card's known printings — the true code only has to be legible
 * in ONE of the recorded frames.
 *
 * Recorded per-zone (see [HybridPipeline] / [CardZones]), not as one flattened string, so a future
 * per-zone vote (Task 10) can read e.g. the SET_CODE zone's history independently of PASSCODE's.
 * [textsFor] flattens each recorded frame back to one string for today's consumers (SetCodeMatch,
 * SetCodeOcr), which still just want plain text.
 */
class SetCodeEvidence(private val maxPerCard: Int = 8) {
    private data class Frame(val zoneTexts: Map<Zone, String>, val legacyText: String)

    private val frames = HashMap<Int, ArrayDeque<Frame>>()

    /** Record one frame's zone texts (+ legacy-band/whole-frame fallback, see [Detection]) for
     *  [passcode]. Ignores an entirely-blank frame and one identical to the last one recorded. */
    fun record(passcode: Int, zoneTexts: Map<Zone, String>, legacyText: String = "") {
        if (passcode <= 0) return
        if (zoneTexts.values.all { it.isBlank() } && legacyText.isBlank()) return
        val frame = Frame(zoneTexts, legacyText)
        val dq = frames.getOrPut(passcode) { ArrayDeque() }
        if (dq.lastOrNull() == frame) return
        dq.addLast(frame)
        while (dq.size > maxPerCard) dq.removeFirst()
    }

    /** Each recorded frame for [passcode], flattened to one string (most recent last). */
    fun textsFor(passcode: Int): List<String> =
        frames[passcode]?.map { concatZoneTexts(it.zoneTexts, it.legacyText) } ?: emptyList()

    fun forget(passcode: Int) { frames.remove(passcode) }
    fun reset() { frames.clear() }
}
