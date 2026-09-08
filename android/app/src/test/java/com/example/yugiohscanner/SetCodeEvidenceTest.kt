package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SetCodeEvidence
import com.example.yugiohscanner.ml.Zone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [SetCodeEvidence.setCodeCandidates] wires [ZoneVote] to real zone text, via SetCodeOcr.extract
 * for the grammar correction (see [ZoneVoteTest] for the pure vote logic in isolation). These
 * tests exercise the full path a recorded frame actually takes: record() -> per-zone extraction ->
 * zone-priority vote.
 */
class SetCodeEvidenceTest {

    @Test fun `one frame with a clean SET_CODE-zone reading is enough`() {
        val ev = SetCodeEvidence()
        ev.record(1234, mapOf(Zone.SET_CODE to "LOB-DE001", Zone.PASSCODE to "12341234"))
        assertEquals(listOf("LOB-DE001"), ev.setCodeCandidates(1234))
    }

    @Test fun `SET_CODE zone wins even when PASSCODE zone repeatedly 'reads' a different plausible code`() {
        val ev = SetCodeEvidence()
        // 6 frames: SET_CODE zone reads the true code once cleanly (frame 3); PASSCODE zone
        // garbles something grammar-valid but wrong on every single frame. Under the old pooled
        // design (concatZoneTexts -> one shared haystack) this volume imbalance is exactly what
        // could let the wrong, frequent reading dominate; per-zone voting must not let that happen.
        repeat(6) { i ->
            val setCodeText = if (i == 2) "LOB-DE001" else ""
            // Trailing frame-index noise keeps each frame's raw text distinct so SetCodeEvidence's
            // own identical-frame dedup (see its record()) doesn't collapse them -- irrelevant to
            // extraction (SetCodeOcr.extract still finds the same "XYZ-DE999" every time) but
            // keeps this test's six-frames premise literal rather than accidentally-collapsed.
            ev.record(1234, mapOf(Zone.SET_CODE to setCodeText, Zone.PASSCODE to "XYZ-DE999 1234123$i"))
        }
        assertEquals(listOf("LOB-DE001"), ev.setCodeCandidates(1234))
    }

    @Test fun `a repeated, grammar-correctable OCR mistake reinforces the right answer, not a wrong one`() {
        val ev = SetCodeEvidence()
        // "SDSE-DEO35" (O for 0) is a real captured OCR mistake (see SetCodeOcrTest) that
        // SetCodeOcr.extract corrects to "SDSE-DE035". Five garbled frames plus one clean frame
        // must all collapse into the SAME candidate, 6-0 -- not compete 5-1.
        repeat(5) { ev.record(5678, mapOf(Zone.SET_CODE to "SDSE-DEO35")) }
        ev.record(5678, mapOf(Zone.SET_CODE to "SDSE-DE035"))
        assertEquals(listOf("SDSE-DE035"), ev.setCodeCandidates(5678))
    }

    @Test fun `no SET_CODE-zone or legacy text anywhere falls back to the PASSCODE zone as last resort`() {
        val ev = SetCodeEvidence()
        ev.record(1234, mapOf(Zone.PASSCODE to "LOB-DE001 12341234"))
        assertEquals(listOf("LOB-DE001"), ev.setCodeCandidates(1234))
    }

    @Test fun `legacy band is used when the layout has no measured SET_CODE zone`() {
        val ev = SetCodeEvidence()
        // Placeholder layouts (SKILL/LEGACY) or an unresolved layout read the legacy band instead
        // of a Zone.SET_CODE crop -- readZones never populates Zone.SET_CODE for those.
        ev.record(1234, mapOf(Zone.PASSCODE to "12341234"), legacyText = "LOB-DE001")
        assertEquals(listOf("LOB-DE001"), ev.setCodeCandidates(1234))
    }

    @Test fun `nothing recorded for this passcode returns empty, not a crash`() {
        val ev = SetCodeEvidence()
        assertTrue(ev.setCodeCandidates(999).isEmpty())
    }

    @Test fun `an untracked passcode's evidence never leaks into another card's vote`() {
        val ev = SetCodeEvidence()
        ev.record(1111, mapOf(Zone.SET_CODE to "LOB-DE001"))
        ev.record(2222, mapOf(Zone.SET_CODE to "SDSE-DE035"))
        assertEquals(listOf("LOB-DE001"), ev.setCodeCandidates(1111))
        assertEquals(listOf("SDSE-DE035"), ev.setCodeCandidates(2222))
    }
}
