package com.example.yugiohscanner.ml

/**
 * Multi-frame, per-zone-per-field consensus over already-corrected OCR candidates (Spec D2 Task
 * 10 -- "Massnahme 4: Mehrframe-Voting pro Zone").
 *
 * Until this task, [SetCodeEvidence] pooled every zone's text into ONE flattened string per frame
 * (see [concatZoneTexts]), and every consumer (`SetCodeMatch.best`) matched against ALL of it
 * concatenated together -- SET_CODE zone, PASSCODE zone and the legacy full-width band, mixed into
 * one haystack across every recorded frame. A good SET_CODE-zone reading on frame 3 and a garbled
 * PASSCODE-zone reading on frame 3 land in the SAME haystack and are indistinguishable to a
 * distance-based matcher; the more frames pool in, the more chances a PASSCODE-zone's noise has to
 * align, by pure accident, closer to some OTHER known printing than the real SET_CODE-zone reading
 * does elsewhere in the same string. Tallying each zone separately removes that channel entirely:
 * one zone's votes never compete with another zone's.
 *
 * PURE: no Bitmap, no Context, no ML Kit -- just strings in, strings out. Unit-testable on the JVM
 * like [CardZones.zoneRect] / [CardLayout.isArtworkShaped]. It knows nothing about frames, cameras
 * or the card pipeline; a caller hands it whatever candidates each zone's reading produced.
 *
 * Callers must extract+correct BEFORE calling [record] (e.g. via [SetCodeOcr.extract]), never
 * tally raw OCR text directly. This is not a style preference: a repeating raw OCR error (e.g.
 * "DIFO-DEO21", the O/0 confusion, seen five times) must fold into the SAME bucket as a single
 * clean read ("DIFO-DE021", seen once) once both go through grammar correction, so they reinforce
 * each other (6 votes, unanimous) instead of the wrong-but-frequent raw string outvoting the rare
 * correct one 5:1. Voting on raw text would silently prefer frequency over correctness; voting
 * after correction turns repetition of a KNOWN, correctable mistake into confirmation instead of
 * noise. See [ZoneVoteTest] for the worked example.
 *
 * "Field" (the second axis in the class name): [record]'s [candidates] are whatever ONE extractor
 * produced for that zone-reading (here, always [SetCodeOcr.extract]'s set-code-shaped tokens).
 * Nothing here is set-code-specific -- a caller could equally tally a PASSCODE-shaped extractor's
 * output for the same zones under the same rules -- but only the set-code field is wired up by
 * [SetCodeEvidence] today; [OcrText.findPasscode] keeps running over the whole pooled text as
 * before (see that call site's own reasoning for why voting was not extended there).
 */
class ZoneVote {

    // `null` stands for the legacy full-width band (CardZones.legacyBand): it is not a CardLayout
    // Zone (see CardZones' own doc on why one must not be fabricated for it), so it needs a key
    // that isn't a real Zone value rather than an invented enum entry.
    //
    // LinkedHashMap so insertion order is preserved -- [candidatesFor]'s tie-break relies on it.
    private val tallies = HashMap<Zone?, LinkedHashMap<String, Int>>()

    /**
     * Record one zone-reading's already-extracted, already-corrected candidates (one reading is
     * usually one frame's OCR of that zone). Each distinct candidate in [candidates] gets exactly
     * one vote for this reading, even if the extractor returned it more than once (e.g. the same
     * code appearing twice in one OCR block) -- a single garbled reading must not out-vote several
     * genuinely different frames by repeating itself internally. Blank input records nothing, so a
     * frame where this zone read nothing simply leaves the tally untouched.
     */
    fun record(zone: Zone?, candidates: Collection<String>) {
        if (candidates.isEmpty()) return
        val tally = tallies.getOrPut(zone) { LinkedHashMap() }
        for (c in candidates.distinct()) tally[c] = (tally[c] ?: 0) + 1
    }

    /**
     * Every distinct candidate recorded for [zone], most-voted first. Ties keep FIRST-SEEN order
     * (stable sort over a [LinkedHashMap]'s insertion order) rather than, say, most-recent-first:
     * there is no evidence that a later frame is more reliable than an earlier one (a user panning
     * past a card is as likely to end on a worse angle as a better one), so an arbitrary-but-
     * deterministic tie-break beats inventing a recency signal the data doesn't support. Empty if
     * nothing has been recorded for [zone].
     *
     * This is also the answer to "what happens after 1 / 2 / n readings": after the FIRST reading
     * that produces any candidate, that candidate is already the sole, immediate winner -- there is
     * no minimum-readings threshold, because a card the user swipes past in half a second may only
     * ever produce one legible reading, and refusing to answer until a third frame arrives would
     * make the vote useless exactly when frames are scarcest. After a SECOND, agreeing reading, the
     * same candidate now leads 2-0 -- more confident, same answer. After a second, DISAGREEING
     * reading, both sit at 1-1 and the tie-break above picks the first one seen (still deterministic,
     * not "no answer"). From N readings on, the plurality (not a majority requirement) wins,
     * exactly like [BoxTracker]'s own no-majority-required confirmation.
     */
    fun candidatesFor(zone: Zone?): List<String> =
        tallies[zone]?.entries?.sortedByDescending { it.value }?.map { it.key } ?: emptyList()

    /**
     * Zone-priority resolution: try each zone in [priority] order and return the FIRST one that
     * has any votes at all, in full (see [candidatesFor]) -- never merged across zones. This is the
     * actual fix this task exists for: a zone with a SINGLE vote still wins outright over a lower-
     * priority zone with many votes, because the two are never compared against each other, let
     * alone pooled into one haystack. A lower-priority zone is consulted only when every
     * higher-priority zone recorded nothing at all across every frame seen so far.
     */
    fun resolve(priority: List<Zone?>): List<String> {
        for (zone in priority) {
            val candidates = candidatesFor(zone)
            if (candidates.isNotEmpty()) return candidates
        }
        return emptyList()
    }
}
