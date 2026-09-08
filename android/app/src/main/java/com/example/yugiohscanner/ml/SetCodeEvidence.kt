package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SetCodeMatch

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

    /**
     * Every recorded frame's text, flattened and UNCORRECTED — one entry per frame.
     *
     * [SetCodeMatch] needs this, not [setCodeCandidates]'s grammar-clean winners, and the two are
     * not interchangeable. That object exists precisely to survive readings the grammar rejects:
     * its own header names the cases — "the hyphen is dropped, digits are confused, the code is
     * split across a line break" — and it normalises with `filter { isLetterOrDigit() }` so a
     * hyphenless read still aligns at distance 0 against a known printing.
     *
     * SET_CODE's pattern, by contrast, demands a literal hyphen, a letter straight after it and
     * contiguous digits. Feeding only its output to the matcher throws away exactly the readings
     * the matcher was built for: "SDSE DE013" (hyphen lost), "SDSE-\nDE013" (ML Kit split the crop
     * into two blocks), "SDSE-0E013" (region D read as 0, a confusion SetCodeMatch scores at 0.5
     * and the grammar cannot express) all become no candidate at all, and `best()` returns null on
     * an empty list.
     *
     * So the caller passes BOTH. A grammar-clean candidate still wins at distance 0; the raw texts
     * only matter when nothing survived the grammar, which is the case worth rescuing.
     */
    fun rawTexts(passcode: Int): List<String> =
        frames[passcode]?.map { concatZoneTexts(it.zoneTexts, it.legacyText) } ?: emptyList()

    /**
     * Every recorded frame's EDITION-zone text for [passcode], one entry per frame -- for
     * [EditionEvidence.add] (Spec D3 Task 7), which requires exactly this: call it once per frame
     * the zone was actually cropped and OCR'd, never for a frame where it wasn't (see that
     * function's own doc on why a layout with no measured EDITION zone must never be recorded at
     * all). [mapNotNull] is the mechanism that enforces that here: a frame whose [Zone.EDITION]
     * key is ABSENT from `zoneTexts` (the layout has no measured zone, e.g. PENDULUM) is dropped,
     * while a frame whose zone was read and came back blank still keeps its (blank) entry -- that
     * distinction (looked vs. never looked) is worth preserving here regardless. What that blank
     * entry then COUNTS as is [EditionEvidence.add]'s call, not this function's: since Spec D3 fix
     * I1, a blank entry no longer confirms "legible" for [EditionEvidence.result]'s `unlimited`
     * case on its own -- an OCR failure on a badly-placed crop returns "" exactly like a genuinely
     * blank zone would, and the two used to be indistinguishable to that rule's advantage (see
     * [EditionEvidence.add]'s own doc).
     */
    fun editionTexts(passcode: Int): List<String> =
        frames[passcode]?.mapNotNull { it.zoneTexts[Zone.EDITION] } ?: emptyList()

    fun forget(passcode: Int) { frames.remove(passcode) }
    fun reset() { frames.clear() }

    companion object {
        /**
         * Spec D3 Task 6 ("Stille Verbesserung", plan Section 6.2): after a card is first
         * confirmed, this class keeps recording new frames for as long as [BoxTracker] still sees
         * it, so a later frame can genuinely resolve the set code better than the one(s) that won
         * the first resolve. This decides whether [new] earns the right to replace what's already
         * staged ([previous] -- `null` when nothing has been staged yet, e.g. the very first
         * resolve).
         *
         * [userTouched] wins unconditionally: it's `true` exactly when the user has hand-corrected
         * this entry's set, rarity, language or edition, and the one failure this task must not
         * have is the automation silently overwriting that correction -- so it short-circuits to
         * `false` before anything else is even looked at, regardless of how much "better" [new]
         * looks.
         *
         * "Better" reuses the exact two signals [ScanConfidence]'s green condition already trusts
         * (`codeFrameCount`, `codeExactMatch` -- Task 6's other half, see
         * [SetCodeMatch.MatchResult]) rather than inventing a third notion of quality: strictly
         * more separate frames confirmed at distance 0 wins outright; at an equal frame count, only
         * newly reaching distance 0 (exact was false, now true) counts as an improvement. A [new]
         * result with no [SetCodeMatch.MatchResult.selected] at all is never an improvement -- there
         * is nothing to prefer it over keeping what is already staged.
         */
        fun shouldSilentlyImprove(
            userTouched: Boolean,
            new: SetCodeMatch.MatchResult,
            previous: SetCodeMatch.MatchResult?,
        ): Boolean {
            if (userTouched) return false
            if (new.selected == null) return false
            if (previous == null) return true
            if (new.codeFrameCount != previous.codeFrameCount) return new.codeFrameCount > previous.codeFrameCount
            return new.codeExactMatch && !previous.codeExactMatch
        }
    }
}
