package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.RarityRank
import com.example.yugiohscanner.ml.ScanConfidence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [ScanConfidence] (Spec D3 Task 5) -- the traffic light. Fuses Tasks 2-4's already-computed
 * signals ([SetCodeMatch.MatchResult], [RarityRank.Result], [EditionEvidence.EditionResult]) into
 * GREEN/YELLOW/RED plus a German reason, per the plan's table (Section 6.4).
 *
 * The main coverage is one parameterised loop ([cases]) that starts from a single all-clear
 * baseline and flips exactly ONE signal per case -- this both walks every row of the table
 * (green/yellow/red) AND isolates each of the plan's yellow reasons individually (code
 * tolerance, code single-frame, rarity ambiguous, edition unknown, edition LOW-but-known, region
 * unclear, region contradicts), since a case that only ever changes one field can't be passing for
 * the wrong reason. Two more targeted tests cover what the loop can't: yellow-reason priority when
 * several conditions fire at once, and the card-beats-setting merge (Spec Section 7).
 */
class ScanConfidenceTest {

    // --- fixtures ----------------------------------------------------------------------------

    private fun option(code: String, rarity: String = "Common") =
        SetOption(setCode = code, rarity = rarity, price = 0.0, language = "DE", verified = true)

    private fun matched(code: String, rarity: String = "Common") = SetCodeMatch.MatchResult(
        selected = option(code, rarity),
        candidates = listOf(option(code, rarity)),
        reason = SetCodeMatch.MatchReason.MATCHED,
    )

    private fun regionUnclear(code: String) = SetCodeMatch.MatchResult(
        selected = option(code),
        candidates = listOf(option(code)),
        reason = SetCodeMatch.MatchReason.REGION_UNCLEAR,
    )

    private fun regionContradicts(code: String) = SetCodeMatch.MatchResult(
        selected = option(code),
        candidates = listOf(option(code)),
        reason = SetCodeMatch.MatchReason.REGION_CONTRADICTS_VERIFIED,
    )

    private val noMatch = SetCodeMatch.MatchResult(null, emptyList(), SetCodeMatch.MatchReason.NO_MATCH)

    private val unambiguousRarity = RarityRank.Result(
        lowest = option("LOB-DE005"),
        isAmbiguous = false,
        distinctRarities = listOf("Common"),
    )

    private val confidentEdition = EditionEvidence.EditionResult("first", EditionEvidence.Confidence.HIGH)

    // The all-clear baseline: every signal at its strongest. Every case below changes exactly one
    // field away from this.
    private val baseline = ScanConfidence.Input(
        matchResult = matched("LOB-DE005"),
        codeExactMatch = true,
        codeFrameCount = 2,
        rarity = unambiguousRarity,
        edition = confidentEdition,
        defaultEdition = "unknown",
    )

    private data class Case(
        val name: String,
        val input: ScanConfidence.Input,
        val expectedLight: ScanConfidence.Light,
        val expectedReason: String?,
    )

    private val cases = listOf(
        Case("green: every signal strong", baseline, ScanConfidence.Light.GREEN, null),

        // --- table row: RED -----------------------------------------------------------------
        Case(
            "red: no code hit at all (Set = Unknown)",
            baseline.copy(matchResult = noMatch),
            ScanConfidence.Light.RED,
            "Kein Code-Treffer",
        ),

        // --- table row: YELLOW, each of its "oder" clauses isolated --------------------------
        Case(
            "yellow: code only matched with tolerance",
            baseline.copy(codeExactMatch = false),
            ScanConfidence.Light.YELLOW,
            "Code unsicher: LOB-DE005",
        ),
        Case(
            "yellow: code seen in only 1 frame",
            baseline.copy(codeFrameCount = 1),
            ScanConfidence.Light.YELLOW,
            "Code unsicher: LOB-DE005",
        ),
        Case(
            "yellow: rarity ambiguous",
            baseline.copy(
                rarity = RarityRank.Result(
                    lowest = option("LOB-DE005", "Ultra Rare"),
                    isAmbiguous = true,
                    distinctRarities = listOf("Ultra Rare", "Secret Rare"),
                ),
            ),
            ScanConfidence.Light.YELLOW,
            "Rarity mehrdeutig: Ultra Rare/Secret Rare",
        ),
        Case(
            "yellow: edition unknown",
            baseline.copy(edition = EditionEvidence.EditionResult("unknown", EditionEvidence.Confidence.LOW)),
            ScanConfidence.Light.YELLOW,
            "Edition nicht erkannt",
        ),
        Case(
            "yellow: edition known but only LOW confidence",
            baseline.copy(edition = EditionEvidence.EditionResult("first", EditionEvidence.Confidence.LOW)),
            ScanConfidence.Light.YELLOW,
            "Edition nicht erkannt",
        ),
        Case(
            "yellow: region unclear",
            baseline.copy(matchResult = regionUnclear("LOB-DE005")),
            ScanConfidence.Light.YELLOW,
            "Region unklar",
        ),
        Case(
            "yellow: region contradicts a verified printing",
            baseline.copy(matchResult = regionContradicts("LOB-DE005")),
            ScanConfidence.Light.YELLOW,
            "Region widerspricht bekanntem Druck",
        ),
    )

    @Test fun `every table row and every yellow reason`() {
        for (case in cases) {
            val result = ScanConfidence.evaluate(case.input)
            assertEquals(case.name, case.expectedLight, result.light)
            assertEquals(case.name, case.expectedReason, result.reason)
        }
    }

    // --- yellow-reason priority when several conditions fire at once -------------------------

    @Test fun `several yellow conditions at once report only the code reason -- documented priority`() {
        val input = baseline.copy(
            codeExactMatch = false,
            rarity = RarityRank.Result(
                lowest = option("LOB-DE005", "Ultra Rare"),
                isAmbiguous = true,
                distinctRarities = listOf("Ultra Rare", "Secret Rare"),
            ),
            edition = EditionEvidence.EditionResult("unknown", EditionEvidence.Confidence.LOW),
            matchResult = regionUnclear("LOB-DE005"),
        )
        val result = ScanConfidence.evaluate(input)
        assertEquals(ScanConfidence.Light.YELLOW, result.light)
        assertEquals("Code unsicher: LOB-DE005", result.reason)
    }

    // --- card-beats-setting (Spec Section 7) --------------------------------------------------

    @Test fun `default 'first' plus HIGH-confidence 'unlimited' detection -- detection wins`() {
        val input = baseline.copy(
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.HIGH),
        )
        assertEquals("unlimited", ScanConfidence.evaluate(input).effectiveEdition)
    }

    @Test fun `LOW-confidence 'unlimited' does NOT override the 'first' default`() {
        val input = baseline.copy(
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.LOW),
        )
        val result = ScanConfidence.evaluate(input)
        assertEquals("first", result.effectiveEdition)
        // LOW confidence also makes this a yellow scan -- the setting wins the VALUE, but the
        // ampel still tells the user to double-check it.
        assertEquals(ScanConfidence.Light.YELLOW, result.light)
        assertEquals("Edition nicht erkannt", result.reason)
    }

    @Test fun `sichere Erkennung schlaegt JEDE Voreinstellung, nicht nur first`() {
        // Nutzerentscheidung 2026-09-08: "Karte schlaegt Einstellung" gilt als Prinzip, nicht als
        // Einzelfall. Woertlich umgesetzt gab das Spec hier "limited" zurueck und warf eine
        // zweifelsfrei gelesene Angabe weg.
        val input = baseline.copy(
            defaultEdition = "limited",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.HIGH),
        )
        assertEquals("unlimited", ScanConfidence.evaluate(input).effectiveEdition)
    }

    @Test fun `die beiden Faelle, die der Wortlaut verlor`() {
        // Voreinstellung unlimited, Karte liest sicher "1. Auflage" -> die Karte gewinnt.
        assertEquals("first", ScanConfidence.evaluate(baseline.copy(
            defaultEdition = "unlimited",
            edition = EditionEvidence.EditionResult("first", EditionEvidence.Confidence.HIGH),
        )).effectiveEdition)
        // Voreinstellung first, Karte liest sicher "Limitierte Auflage" -> die Karte gewinnt.
        assertEquals("limited", ScanConfidence.evaluate(baseline.copy(
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("limited", EditionEvidence.Confidence.HIGH),
        )).effectiveEdition)
    }

    @Test fun `LOW und unknown lassen die Voreinstellung stehen`() {
        // Der Rueckfall bleibt: nur eine SICHERE Lesung gewinnt. Ein einzelner Frame (LOW) oder
        // gar keine Lesung (unknown) aendert nichts an der Einstellung.
        assertEquals("first", ScanConfidence.evaluate(baseline.copy(
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.LOW),
        )).effectiveEdition)
        assertEquals("first", ScanConfidence.evaluate(baseline.copy(
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("unknown", EditionEvidence.Confidence.HIGH),
        )).effectiveEdition)
    }

    @Test fun `effectiveEdition is resolved even for a RED result`() {
        val input = baseline.copy(
            matchResult = noMatch,
            defaultEdition = "first",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.HIGH),
        )
        val result = ScanConfidence.evaluate(input)
        assertEquals(ScanConfidence.Light.RED, result.light)
        assertEquals("unlimited", result.effectiveEdition)
    }

    @Test fun `ohne sichere Lesung traegt die Voreinstellung durch`() {
        // Die Grundlage enthaelt eine SICHERE Lesung -- die wuerde jetzt gewinnen. Hier geht es um
        // den Rueckfall, also muss die Lesung ausdruecklich unsicher sein.
        val result = ScanConfidence.evaluate(baseline.copy(
            defaultEdition = "unlimited",
            edition = EditionEvidence.EditionResult("unknown", EditionEvidence.Confidence.LOW),
        ))
        assertEquals("unlimited", result.effectiveEdition)
    }

    // --- Task 6: codeExactMatch / codeFrameCount genuinely produced by SetCodeMatch ------------
    //
    // Every case above hand-supplies matchResult/codeExactMatch/codeFrameCount as three
    // independent fields, exactly the gap Task 5 left open (see Input's own KDoc). These two feed
    // SetCodeMatch.best()'s REAL output straight through -- no matched()/regionUnclear() helper --
    // to prove green can now genuinely fire, and does not fire on a case that would only look green
    // if codeFrameCount were read off the pooled distance instead of counted per frame.

    @Test fun `green genuinely fires off SetCodeMatch's real per-frame count -- two separately clean frames`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        val input = baseline.copy(
            matchResult = match, codeExactMatch = match.codeExactMatch, codeFrameCount = match.codeFrameCount,
        )
        val result = ScanConfidence.evaluate(input)
        assertEquals(ScanConfidence.Light.GREEN, result.light)
        assertNull(result.reason)
    }

    @Test fun `one clean frame plus one unrelated garbled frame stays yellow -- pooled distance alone must not fake green`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "QQQQQQQQQQQQQQQQQQQQQQQQ")
        val match = SetCodeMatch.best(frames, known, frames)
        // Sanity check on the premise: the pooled match itself still succeeds (one frame carries a
        // clean reading, and best() searches the whole pooled haystack) -- it's specifically the
        // FRAME COUNT, not whether a match was found at all, that this test is pinning.
        assertEquals(SetCodeMatch.MatchReason.MATCHED, match.reason)
        assertEquals(1, match.codeFrameCount)
        val input = baseline.copy(
            matchResult = match, codeExactMatch = match.codeExactMatch, codeFrameCount = match.codeFrameCount,
        )
        val result = ScanConfidence.evaluate(input)
        assertEquals(ScanConfidence.Light.YELLOW, result.light)
        assertEquals("Code unsicher: LOB-DE005", result.reason)
    }

    // --- Task 7: fromEvidence -- the ScanScreen wiring gap ---------------------------------
    //
    // fromEvidence composes already-tested pieces (EditionEvidence, RarityRank.lowest, evaluate);
    // these tests only check the WIRING (raw per-frame texts / the known-sets group reach the
    // right place), not re-prove any of those pieces' own logic -- see EditionEvidenceTest /
    // RarityRankTest for that coverage.

    @Test fun `fromEvidence -- edition texts feed a fresh EditionEvidence, one add() per frame`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        // Two frames reading the LIMITED marker -> EditionEvidence.result() is (limited, HIGH) --
        // known-and-HIGH is enough to clear the ampel's OWN edition check, which is how this test
        // proves editionTexts actually reached EditionEvidence (ignored, it would default to
        // unknown/LOW and stay yellow, per the next test).
        val result = ScanConfidence.fromEvidence(
            match, known, editionTexts = listOf("Limitierte Auflage", "LIMITIERTE AUFLAGE"), defaultEdition = "unknown",
        )
        assertEquals(ScanConfidence.Light.GREEN, result.light)
        // Seit der Nutzerentscheidung gewinnt jede sichere Lesung: hier wurde "limited" in zwei
        // Frames gelesen, also steht "limited" im Ergebnis -- nicht die unbeteiligte Einstellung.
        assertEquals("limited", result.effectiveEdition)
    }

    @Test fun `fromEvidence -- no edition texts at all reports unknown, not a crash`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        val result = ScanConfidence.fromEvidence(match, known, editionTexts = emptyList(), defaultEdition = "unknown")
        assertEquals(ScanConfidence.Light.YELLOW, result.light)
        assertEquals("Edition nicht erkannt", result.reason)
    }

    @Test fun `fromEvidence -- rarity comes from the FULL knownSets list grouped by the winning code, not match's own (single-entry) candidates`() {
        // Two rows share the exact winning setCode string but differ in rarity -- RarityRank's own
        // target case. match.candidates itself would NOT carry this (SetCodeMatch.best's Case 1
        // always collapses MATCHED down to listOf(selected)) -- that's exactly the gap this
        // function's own KDoc explains, and this test pins the fix: it must be [knownSets] that
        // gets filtered, not [match]'s own field.
        val known = listOf(
            SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE", verified = true),
            SetOption("LOB-DE005", "Secret Rare", 0.0, "DE", verified = true),
        )
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        assertEquals("match.candidates itself is the single-entry gap this function works around",
            1, match.candidates.size)
        val result = ScanConfidence.fromEvidence(
            match, known, editionTexts = listOf("1st Edition", "1st Edition"), defaultEdition = "unknown",
        )
        assertEquals(ScanConfidence.Light.YELLOW, result.light)
        assertEquals("Rarity mehrdeutig: Ultra Rare/Secret Rare", result.reason)
    }

    @Test fun `fromEvidence -- no rarity disagreement in knownSets for the winning code -- not ambiguous`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        val result = ScanConfidence.fromEvidence(
            match, known, editionTexts = listOf("1st Edition", "1st Edition"), defaultEdition = "unknown",
        )
        assertEquals(ScanConfidence.Light.GREEN, result.light)
    }

    @Test fun `fromEvidence -- no selection at all (RED) -- rarity is never even looked up`() {
        val result = ScanConfidence.fromEvidence(
            noMatch, emptyList(), editionTexts = emptyList(), defaultEdition = "unknown",
        )
        assertEquals(ScanConfidence.Light.RED, result.light)
        assertEquals("Kein Code-Treffer", result.reason)
    }

    @Test fun `fromEvidence -- every signal strong end to end reaches green, edition override included`() {
        val known = listOf(SetOption("LOB-DE005", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE005", "LOB-DE005")
        val match = SetCodeMatch.best(frames, known, frames)
        // No marker on any frame, but the zone WAS legible (blank, not absent) on all three --
        // EditionEvidence.result()'s `unlimited` case, HIGH at >=3 legible frames.
        val result = ScanConfidence.fromEvidence(
            match, known, editionTexts = listOf("", "", ""), defaultEdition = "first",
        )
        assertEquals(ScanConfidence.Light.GREEN, result.light)
        assertNull(result.reason)
        // Card-beats-setting (Spec Section 7): default "first" + detected "unlimited" at HIGH
        // confidence -> detection wins, end to end through fromEvidence.
        assertEquals("unlimited", result.effectiveEdition)
    }
}
