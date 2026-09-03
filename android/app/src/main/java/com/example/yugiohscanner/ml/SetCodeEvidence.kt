package com.example.yugiohscanner.ml

/**
 * Multi-frame set-code voting. The set code is tiny print and any single frame may be blurred,
 * glared, or partly cut off, so we accumulate the bottom-band OCR text of each card across the
 * frames it's visible (keyed by passcode) and resolve it from all of them at once. Downstream,
 * SetCodeMatch matches this pooled evidence against the card's known printings — the true code
 * only has to be legible in ONE of the recorded frames.
 */
class SetCodeEvidence(private val maxPerCard: Int = 8) {
    private val texts = HashMap<Int, ArrayDeque<String>>()

    /** Record one frame's band text for [passcode]. Ignores blanks and consecutive duplicates. */
    fun record(passcode: Int, bandText: String) {
        if (passcode <= 0 || bandText.isBlank()) return
        val dq = texts.getOrPut(passcode) { ArrayDeque() }
        if (dq.lastOrNull() == bandText) return
        dq.addLast(bandText)
        while (dq.size > maxPerCard) dq.removeFirst()
    }

    /** All recorded band texts for [passcode] (most recent last). */
    fun textsFor(passcode: Int): List<String> = texts[passcode]?.toList() ?: emptyList()

    fun forget(passcode: Int) { texts.remove(passcode) }
    fun reset() { texts.clear() }
}
