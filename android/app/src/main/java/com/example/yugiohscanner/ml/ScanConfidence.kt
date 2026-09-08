package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SetCodeMatch

// The traffic light (Spec D3 Task 5, plan Section 6.4). PURE: no Android types (no Bitmap,
// Context, Compose state), just the Kotlin signal types Tasks 2-4 already produce -- consuming
// them instead of re-deriving anything they already know, per this task's own brief and the KDoc
// on SetCodeMatch.MatchResult ("the traffic light reads this instead of re-deriving it").
//
// Green is a promise: "you do not need to check this one." It requires THREE things at once (code
// distance 0 in >=2 frames, rarity unambiguous, edition != unknown) -- a single weak signal is
// enough to fall back to yellow. This deliberately does not get softened to produce more green;
// see [evaluate]'s KDoc for the measured reality (D2's OCR benchmark) that makes yellow the
// expected, honest outcome for most scans.
object ScanConfidence {

    enum class Light { GREEN, YELLOW, RED }

    /**
     * [reason] is `null` only for GREEN (nothing to call out) and otherwise the German text
     * naming the concrete case, per the plan's requirement that `reason` name the case, not just
     * the level (e.g. `"Rarity mehrdeutig: Ultra/Secret"`, not just "ambiguous").
     *
     * [effectiveEdition] is the edition value the card-beats-setting rule (Spec Section 7)
     * resolved -- see [evaluate]'s KDoc on why that merge lives here. It is always one of
     * [com.example.yugiohscanner.cloud.Valuation.EDITIONS] and is populated for every light, not
     * just GREEN, since a caller staging a RED or YELLOW card still needs *some* edition value to
     * prefill (same as today's un-overridden `Prefs.defaultEdition` prefill in `ScanScreen`).
     */
    data class Result(
        val light: Light,
        val reason: String?,
        val effectiveEdition: String,
    )

    /**
     * Everything [evaluate] needs, already computed by Tasks 1-4 -- this object fuses their
     * outputs, it does not recompute any of them.
     *
     * [matchResult] is Task 2's [SetCodeMatch.MatchResult] for the card's set code: `selected ==
     * null` (equivalently `reason == NO_MATCH`) is this table's RED case ("kein Code-Treffer");
     * `reason`'s two region cases (`REGION_UNCLEAR` / `REGION_CONTRADICTS_VERIFIED`) are two of the
     * table's YELLOW cases, and their German text is read straight off
     * [SetCodeMatch.MatchReason.text] rather than duplicated here.
     *
     * [codeExactMatch] and [codeFrameCount] are the table's "Code-Distanz 0 in >=2 Frames" signal
     * -- and the one input this object CANNOT source from Tasks 2-4 today. `SetCodeMatch.best()`
     * pools every frame's evidence into one joined haystack and returns a single match with no
     * exposed edit distance and no per-frame breakdown (its internal `Scored.dist` is private);
     * neither `SetCodeEvidence` nor `ZoneVote` records "this known printing matched this frame at
     * distance 0" either -- `ZoneVote`'s per-candidate tallies count frames that produced the SAME
     * grammar-corrected string, not frames that matched a KNOWN printing at distance 0, which is a
     * different fact. So until a future change teaches `SetCodeMatch` (or a caller wrapping it) to
     * report that per-frame, whoever assembles this `Input` (Task 7's staging wiring, most likely)
     * has to supply it directly; this object only ever consumes it, never approximates it from
     * `matchResult` alone -- see this task's report for the finding written up in full.
     *
     * [rarity] is Task 3's [RarityRank.Result] for the matched group ([RarityRank.isAmbiguous] +
     * [RarityRank.distinctRarities] feed the "Rarity mehrdeutig: X/Y" reason directly); `null` when
     * the caller has nothing to rank (e.g. RED already short-circuits before rarity would matter).
     *
     * [edition] is Task 4's [EditionEvidence.EditionResult] for the EDITION zone, deliberately the
     * RAW detected reading, not [Result.effectiveEdition] -- see [evaluate]'s KDoc on why the
     * ampel must judge what was actually seen, not what the settings default silently fills in.
     *
     * [defaultEdition] is the user's Spec A `default_edition` setting (`Prefs.defaultEdition`),
     * needed only for the card-beats-setting merge, never for the ampel colour itself.
     */
    data class Input(
        val matchResult: SetCodeMatch.MatchResult,
        val codeExactMatch: Boolean,
        val codeFrameCount: Int,
        val rarity: RarityRank.Result?,
        val edition: EditionEvidence.EditionResult,
        val defaultEdition: String,
    )

    /**
     * The plan's table (Section 6.4), evaluated in order RED -> YELLOW -> GREEN:
     *
     * | Ampel | Bedingung |
     * |---|---|
     * | Gruen | Code-Distanz 0 in >=2 Frames UND Rarity eindeutig UND Edition != unknown |
     * | Gelb | Code nur mit Toleranz/1 Frame, ODER Rarity mehrdeutig, ODER Edition unknown/LOW, ODER Region unklar, ODER Region widerspricht einem bekannten Druck |
     * | Rot | kein Code-Treffer (Set = Unknown) |
     *
     * When several YELLOW conditions fire at once, only one `reason` can be shown -- the table
     * itself doesn't rank them, so this picks a fixed, documented priority: code confidence first
     * (the input everything else assumes is even legible), then rarity, then edition, then the two
     * region cases (unclear before contradicts, matching [SetCodeMatch]'s own case numbering). This
     * ordering is this task's own assumption, not something the plan specifies.
     *
     * The measured reality this is built on: D2's OCR benchmark (`ml/ocr_bench/report-2026-09-08.md`)
     * reads the set code on only 37.5-53.8% of single frames, and GREEN requires distance 0 in
     * *two* of them at once, on top of unambiguous rarity and a known edition. Expect YELLOW far
     * more often than GREEN -- that is the honest result of a real card and a real camera, not a
     * bug in this table. Loosening any single condition to chase more green would let a wrong
     * printing slip through as a "you don't need to check this" promise, which is the one outcome
     * the plan's Task 9 acceptance (>=25/30 green, **zero false greens**) treats as worse than
     * missing the 25.
     */
    fun evaluate(input: Input): Result {
        val effectiveEdition = resolveEdition(input.edition, input.defaultEdition)
        val selected = input.matchResult.selected

        if (selected == null || input.matchResult.reason == SetCodeMatch.MatchReason.NO_MATCH) {
            return Result(Light.RED, "Kein Code-Treffer", effectiveEdition)
        }

        if (!input.codeExactMatch || input.codeFrameCount < 2) {
            return Result(Light.YELLOW, "Code unsicher: ${selected.setCode}", effectiveEdition)
        }
        if (input.rarity?.isAmbiguous == true) {
            val names = input.rarity.distinctRarities.joinToString("/")
            return Result(Light.YELLOW, "Rarity mehrdeutig: $names", effectiveEdition)
        }
        if (input.edition.edition == "unknown" || input.edition.confidence == EditionEvidence.Confidence.LOW) {
            return Result(Light.YELLOW, "Edition nicht erkannt", effectiveEdition)
        }
        if (input.matchResult.reason == SetCodeMatch.MatchReason.REGION_UNCLEAR) {
            return Result(Light.YELLOW, SetCodeMatch.MatchReason.REGION_UNCLEAR.text!!, effectiveEdition)
        }
        if (input.matchResult.reason == SetCodeMatch.MatchReason.REGION_CONTRADICTS_VERIFIED) {
            return Result(Light.YELLOW, SetCodeMatch.MatchReason.REGION_CONTRADICTS_VERIFIED.text!!, effectiveEdition)
        }

        return Result(Light.GREEN, null, effectiveEdition)
    }

    /**
     * Spec Section 7, verbatim: if the user's default edition is `first` and the EDITION zone
     * reads `unlimited` at HIGH confidence, detection wins over the setting -- the card beats the
     * setting. [EditionEvidence.result]'s own KDoc explicitly defers this merge to Task 5 ("That
     * merge with the Spec A default is Task 5's job (the traffic light), not this class's"), so
     * this is that rule's code home; [EditionEvidenceTest]'s two pinning tests already cover that
     * `EditionEvidence` itself reaches exactly the `(unlimited, HIGH)` / `(unlimited, LOW)` inputs
     * this rule keys off of.
     *
     * Deliberately narrow: the plan states this ONE direction only (`first` default + `unlimited`
     * HIGH detection). It says nothing about, say, a `limited` default contradicted by a HIGH
     * `first` detection, so this does not generalise "detection always beats an unconfirmed
     * setting" -- that would be inventing a policy the plan never stated. Outside this one
     * documented case, the setting stands, same as today's un-overridden `Prefs.defaultEdition`
     * prefill in `ScanScreen`.
     */
    private fun resolveEdition(detected: EditionEvidence.EditionResult, defaultEdition: String): String {
        val detectionWins = defaultEdition == "first" &&
            detected.edition == "unlimited" &&
            detected.confidence == EditionEvidence.Confidence.HIGH
        return if (detectionWins) "unlimited" else defaultEdition
    }
}
