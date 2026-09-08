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

    @Test fun `the override only fires for a 'first' default, not other defaults`() {
        val input = baseline.copy(
            defaultEdition = "limited",
            edition = EditionEvidence.EditionResult("unlimited", EditionEvidence.Confidence.HIGH),
        )
        assertEquals("limited", ScanConfidence.evaluate(input).effectiveEdition)
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

    @Test fun `no override -- effectiveEdition just carries the default through unchanged`() {
        val result = ScanConfidence.evaluate(baseline.copy(defaultEdition = "unlimited"))
        assertEquals("unlimited", result.effectiveEdition)
        assertNull(result.reason)
    }
}
