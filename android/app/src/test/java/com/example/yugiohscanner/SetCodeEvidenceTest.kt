package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.SetCodeEvidence
import com.example.yugiohscanner.ml.Zone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test fun `rawTexts liefert genau die Lesungen, die die Grammatik verwirft`() {
        // Der Regressionstest zum Abschlussreview: SetCodeMatch gleicht die bekannten Drucke gegen
        // den ROHEN Text ab, Trennzeichen entfernt, und ist genau fuer die Faelle gebaut, an denen
        // SET_CODEs Muster scheitert. Wuerde man ihm nur setCodeCandidates geben, waeren diese
        // Frames stumm -- best() bekaeme eine leere Liste und lieferte null.
        val ev = SetCodeEvidence()
        ev.record(1234, mapOf(Zone.SET_CODE to "SDSE DE013"))       // Bindestrich verloren
        ev.record(1234, mapOf(Zone.SET_CODE to "SDSE-\nDE013"))     // ueber zwei Textbloecke
        ev.record(1234, mapOf(Zone.SET_CODE to "SDSE-0E013"))       // Region D als 0 gelesen
        assertTrue("keine dieser Lesungen ueberlebt die Grammatik",
            ev.setCodeCandidates(1234).isEmpty())
        val raw = ev.rawTexts(1234)
        assertEquals("aber alle drei bleiben als Rohtext erhalten", 3, raw.size)
        assertTrue(raw.any { it.contains("SDSE DE013") })
        assertTrue(raw.any { it.contains("SDSE-0E013") })
    }

    @Test fun `rawTexts ohne Aufzeichnung ist leer, kein Absturz`() {
        assertTrue(SetCodeEvidence().rawTexts(999).isEmpty())
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

    // -- shouldSilentlyImprove (Spec D3 Task 6, "Stille Verbesserung", plan Section 6.2) ----------
    //
    // SetCodeEvidence keeps collecting after the first confirmation for as long as BoxTracker
    // still sees the card (ScanScreen no longer calls forget() on confirmation); every later frame
    // re-resolves the evidence and shouldSilentlyImprove decides whether that new resolve earns the
    // right to replace what's already staged. The one failure this must never have is overwriting a
    // deliberate user correction (userTouched=true) -- covered first and separately from the
    // "genuinely better" cases so a bug in one can't hide behind the other.

    private fun option(code: String) = SetOption(setCode = code, rarity = "Common", price = 0.0, language = "DE")

    private fun result(code: String?, exact: Boolean, frames: Int) = SetCodeMatch.MatchResult(
        selected = code?.let { option(it) },
        candidates = code?.let { listOf(option(it)) } ?: emptyList(),
        reason = if (code != null) SetCodeMatch.MatchReason.MATCHED else SetCodeMatch.MatchReason.NO_MATCH,
        codeExactMatch = exact,
        codeFrameCount = frames,
    )

    @Test fun `userTouched blocks the update even when the new hit is strictly better`() {
        val weak = result("LOB-DE001", exact = false, frames = 1)
        val strong = result("LOB-DE001", exact = true, frames = 5)
        assertFalse(
            "eine vom Nutzer angefasste Karte darf die Automatik nicht ueberschreiben",
            SetCodeEvidence.shouldSilentlyImprove(userTouched = true, new = strong, previous = weak),
        )
    }

    @Test fun `userTouched blocks the update even when nothing was staged yet`() {
        // Defensive: userTouched must win even against a null previous (first-ever resolve) --
        // in practice this combination shouldn't arise (nothing to touch before it's staged), but
        // the flag's whole point is that it wins unconditionally, not "unless previous is null".
        assertFalse(SetCodeEvidence.shouldSilentlyImprove(userTouched = true, new = result("LOB-DE001", true, 2), previous = null))
    }

    @Test fun `no previous hit -- any real match is an improvement`() {
        assertTrue(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = result("LOB-DE001", false, 1), previous = null))
    }

    @Test fun `a new hit with no selected printing is never an improvement`() {
        val previous = result("LOB-DE001", exact = false, frames = 1)
        val noHit = result(null, exact = false, frames = 0)
        assertFalse(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = noHit, previous = previous))
    }

    @Test fun `strictly more exact frames is an improvement, untouched`() {
        val previous = result("LOB-DE001", exact = true, frames = 1)
        val new = result("LOB-DE001", exact = true, frames = 2)
        assertTrue(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = new, previous = previous))
    }

    @Test fun `fewer exact frames is NOT an improvement, even untouched`() {
        val previous = result("LOB-DE001", exact = true, frames = 3)
        val new = result("LOB-DE001", exact = true, frames = 2)
        assertFalse(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = new, previous = previous))
    }

    @Test fun `equal frame count but now exact where it previously wasn't -- an improvement`() {
        val previous = result("LOB-DE001", exact = false, frames = 2)
        val new = result("LOB-DE001", exact = true, frames = 2)
        assertTrue(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = new, previous = previous))
    }

    @Test fun `equal frame count, equally exact -- no change, not an improvement`() {
        val previous = result("LOB-DE001", exact = true, frames = 2)
        val new = result("LOB-DE001", exact = true, frames = 2)
        assertFalse(SetCodeEvidence.shouldSilentlyImprove(userTouched = false, new = new, previous = previous))
    }
}
