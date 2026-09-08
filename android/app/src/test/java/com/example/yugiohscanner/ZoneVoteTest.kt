package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Zone
import com.example.yugiohscanner.ml.ZoneVote
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ZoneVote] pinned per Task 10's design constraints (Spec D2 "Massnahme 4"): pure, per-zone,
 * per-field consensus over already-corrected candidates. See its class doc for the reasoning this
 * test suite is pinning; a couple of these tests are the exact worked examples cited there.
 */
class ZoneVoteTest {

    // --- "what happens after 1 / 2 / n readings" (constraint 3) -----------------------------

    @Test fun `one reading is answered immediately, no threshold`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        assertEquals(listOf("LOB-DE001"), vote.candidatesFor(Zone.SET_CODE))
    }

    @Test fun `two agreeing readings just reinforce the same winner`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        assertEquals(listOf("LOB-DE001"), vote.candidatesFor(Zone.SET_CODE))
    }

    @Test fun `two disagreeing readings tie -- the first one seen wins, not 'no answer'`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE002"))
        // 1-1 tie: candidatesFor still returns something (never empty just because of a tie), and
        // the tie-break is deterministic (first-seen), not recency or alphabetical.
        assertEquals(listOf("LOB-DE001", "LOB-DE002"), vote.candidatesFor(Zone.SET_CODE))
    }

    @Test fun `n readings -- plurality wins, no majority required`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE002"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE002"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE003"))
        // LOB-DE002 has 2 of 4 votes -- a plurality, not a majority -- and still wins outright.
        assertEquals("LOB-DE002", vote.candidatesFor(Zone.SET_CODE).first())
    }

    @Test fun `a reading with no candidates leaves the tally untouched`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        vote.record(Zone.SET_CODE, emptyList())
        assertEquals(listOf("LOB-DE001"), vote.candidatesFor(Zone.SET_CODE))
    }

    @Test fun `a single reading naming the same code twice does not double-vote`() {
        val vote = ZoneVote()
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE001", "LOB-DE001"))
        vote.record(Zone.SET_CODE, listOf("LOB-DE002"))
        // Without per-reading dedup this would be 3-1 for LOB-DE001; with it, it's the true 2-1.
        assertEquals("LOB-DE001", vote.candidatesFor(Zone.SET_CODE).first())
    }

    // --- disagreement across zones is never diluted (constraint 2 / the task's whole point) ---

    @Test fun `a good SET_CODE-zone reading is not diluted by the same frames' bad PASSCODE-zone reading`() {
        val vote = ZoneVote()
        // SET_CODE zone: one clean, correct reading.
        vote.record(Zone.SET_CODE, listOf("LOB-DE001"))
        // PASSCODE zone, across many more frames: repeatedly "sees" a plausible but WRONG code
        // (garbage that happens to be grammar-valid). Under the old pooled-string design this
        // would have competed in the same haystack; here it lives in a completely separate tally.
        repeat(6) { vote.record(Zone.PASSCODE, listOf("XYZ-DE999")) }

        assertEquals(listOf("LOB-DE001"), vote.candidatesFor(Zone.SET_CODE))
        assertEquals(listOf("XYZ-DE999"), vote.candidatesFor(Zone.PASSCODE))
        // resolve() with SET_CODE first must return the SET_CODE zone's answer, full stop -- the
        // PASSCODE zone's 6 votes never even enter the comparison.
        assertEquals(listOf("LOB-DE001"), vote.resolve(listOf(Zone.SET_CODE, null, Zone.PASSCODE)))
    }

    @Test fun `resolve falls through to a lower-priority zone only when the higher one is silent`() {
        val vote = ZoneVote()
        vote.record(Zone.PASSCODE, listOf("LOB-DE001"))
        // SET_CODE zone recorded nothing at all across every frame -- only then does PASSCODE's
        // (still real, grammar-valid) candidate get used.
        assertEquals(emptyList<String>(), vote.candidatesFor(Zone.SET_CODE))
        assertEquals(listOf("LOB-DE001"), vote.resolve(listOf(Zone.SET_CODE, null, Zone.PASSCODE)))
    }

    @Test fun `legacy band (null zone) sits in the priority chain like any other zone`() {
        val vote = ZoneVote()
        vote.record(null, listOf("LOB-DE001"))
        assertEquals(listOf("LOB-DE001"), vote.resolve(listOf(Zone.SET_CODE, null, Zone.PASSCODE)))
    }

    @Test fun `resolve returns empty when nothing was ever recorded anywhere`() {
        val vote = ZoneVote()
        assertTrue(vote.resolve(listOf(Zone.SET_CODE, null, Zone.PASSCODE)).isEmpty())
    }

    // --- repeated OCR error vs. a single clean read (constraint 4) ---------------------------

    @Test fun `a repeated CORRECTED error reinforces the matching clean read instead of outvoting it`() {
        // The class doc's worked example: "DIFO-DEO21" (O misread for 0 in the digit run) is what
        // SetCodeOcr.extract would correct to "DIFO-DE021" BEFORE this vote ever sees it -- so by
        // the time ZoneVote.record is called, both the noisy and the clean reading are already the
        // SAME string. This test pins the CONSEQUENCE of that ordering (which is asserted directly
        // in SetCodeEvidenceTest): once corrected, repetition reinforces the right answer instead
        // of competing with it.
        val vote = ZoneVote()
        repeat(5) { vote.record(Zone.SET_CODE, listOf("DIFO-DE021")) }   // 5x corrected "DIFO-DEO21"
        vote.record(Zone.SET_CODE, listOf("DIFO-DE021"))                // 1x clean read
        assertEquals(listOf("DIFO-DE021"), vote.candidatesFor(Zone.SET_CODE))
    }

    @Test fun `if correction were skipped, the repeated raw error WOULD wrongly outvote the clean read`() {
        // Negative control demonstrating why the correction-before-vote ordering matters: fed RAW
        // (uncorrected) strings, the vote has no way to know they refer to the same code and the
        // frequent mistake wins outright. This is the failure mode constraint 4 warns against --
        // SetCodeEvidence.setCodeCandidates avoids it by calling SetCodeOcr.extract() before
        // ZoneVote.record(), never the reverse.
        val vote = ZoneVote()
        repeat(5) { vote.record(Zone.SET_CODE, listOf("DIFO-DEO21")) }   // raw, uncorrected
        vote.record(Zone.SET_CODE, listOf("DIFO-DE021"))                 // raw, already clean
        assertEquals("DIFO-DEO21", vote.candidatesFor(Zone.SET_CODE).first())
    }
}
