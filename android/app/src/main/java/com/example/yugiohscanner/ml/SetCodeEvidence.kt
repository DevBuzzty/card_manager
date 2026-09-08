package com.example.yugiohscanner.ml

/**
 * Multi-frame set-code voting. The set code is tiny print and any single frame may be blurred,
 * glared, or partly cut off, so we accumulate each card's OCR text across the frames it's visible
 * (keyed by passcode) and resolve it from all of them at once. Downstream, SetCodeMatch matches
 * this evidence against the card's known printings — the true code only has to be legible in ONE
 * of the recorded frames.
 *
 * Recorded per-zone (see [HybridPipeline] / [CardZones]), not as one flattened string, precisely so
 * [setCodeCandidates] (Task 10) can vote the SET_CODE zone's history independently of PASSCODE's --
 * see [ZoneVote]'s class doc for why that separation is the point: a good SET_CODE-zone reading
 * must not be diluted by the same card's bad PASSCODE-zone reading.
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

    // Zone priority for resolving the set-code field out of [ZoneVote]: the measured SET_CODE
    // zone first (it exists specifically for this text, see CardLayout's class doc); then the
    // legacy full-width band (`null` -- read only when the layout is unmeasured or a placeholder,
    // see HybridPipeline.readZones' `needsLegacyBand`); then PASSCODE last, since it is never
    // intentionally read for a set code and is only worth trying at all because a badly-placed box
    // can occasionally let the code bleed into it. A higher-priority zone with even one vote wins
    // outright over a lower-priority zone with many -- see [ZoneVote.resolve].
    private val setCodeZonePriority = listOf<Zone?>(Zone.SET_CODE, null, Zone.PASSCODE)

    /**
     * The set-code candidates recorded for [passcode] so far, resolved by [ZoneVote] across every
     * frame recorded (most-voted first within the winning zone; see [ZoneVote.candidatesFor] for
     * the tie-break). Each zone-reading is extracted+corrected via [SetCodeOcr.extract] BEFORE it
     * is tallied -- voting on raw OCR text would let a repeating uncorrected mistake outvote a rare
     * clean read; see [ZoneVote]'s class doc. Empty if nothing recorded, or nothing recorded ever
     * produced a set-code-shaped token in any zone.
     */
    fun setCodeCandidates(passcode: Int): List<String> {
        val dq = frames[passcode] ?: return emptyList()
        val vote = ZoneVote()
        for (frame in dq) {
            for ((zone, text) in frame.zoneTexts) vote.record(zone, SetCodeOcr.extract(text))
            vote.record(null, SetCodeOcr.extract(frame.legacyText))
        }
        return vote.resolve(setCodeZonePriority)
    }

    fun forget(passcode: Int) { frames.remove(passcode) }
    fun reset() { frames.clear() }
}
