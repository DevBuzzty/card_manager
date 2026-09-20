package com.example.yugiohscanner.ml

import java.text.Normalizer

/**
 * Multi-frame edition detection from the EDITION zone (Spec D3 Task 4, plan §7). PURE: no Android
 * types, no Bitmap, no I/O -- like [ZoneVote] / [SetCodeOcr], a caller hands it whatever text one
 * frame's EDITION-zone crop OCR'd to, already cropped and read by someone else (HybridPipeline,
 * not built here).
 *
 * A layout with no measured EDITION zone (PENDULUM -- see [CardLayout]'s class doc: only 28
 * candidates after outlier rejection, below the 40-sample floor, and no second measurement to
 * argue tightness from) has no crop to read at all. The caller must then never call [add] for
 * that card; an instance nothing was ever recorded on answers `unknown` from [result] below, which
 * is the correct, disclosed answer -- not a gap papered over with a guess.
 *
 * Marker matching is PORTED, not reinvented, from `ml/label_setcodes.py`'s `FIRST_PATTERNS` /
 * `LIMITED_PATTERNS` (Spec D2 Task 3's ground-truth labeller, 97.0% edition coverage over 5,651
 * eBay photos; `ml/measure_zones.py` imports the very same patterns for the EDITION zone's own
 * ground truth rather than keeping a second copy -- see its `_edition_matchers()`). That file's
 * docstring records four real OCR-tolerance bugs found by hand-verification and fixed: "1st
 * Edition"/"1. Auflage" only need the trailing, unambiguous word (`EDITION`, `AU.LAG.`) because the
 * leading "1st"/"1." garbles unpredictably on real photos -- "13 Auflage", "K Auflage" (a PSA-slab
 * photo), "IS Edition" (the "1st" collapsed, T dropped) were all observed, i.e. not just
 * digit-confusion but characters vanishing or changing class outright -- and `AU.LAG.` additionally
 * tolerates the F and trailing E themselves getting garbled ("AUllagE", "AUtlagE"), the two
 * positions demonstrably unreliable on real captures. Deliberately NOT [OcrText.CONFUSE]: that
 * table maps letters to digits to force an all-digit passcode ('D'->'0', 'E'->'3', ...) and applied
 * to words it destroys them -- "DE" becomes "03". These patterns instead tolerate exactly the
 * garblings observed on the marker text itself, nothing more.
 *
 * LIMITED is matched before FIRST for the same reason `find_edition()` does it: FIRST's bare
 * `EDITION` / `AU.LAG.` would otherwise also fire on a "LIMITED EDITION" / "LIMITIERTE AUFLAGE"
 * card and mislabel it "first".
 */
class EditionEvidence {

    enum class Confidence { HIGH, LOW }

    /** [edition] is one of `first`/`limited`/`unlimited`/`unknown`. */
    data class EditionResult(val edition: String, val confidence: Confidence)

    companion object {
        // Tolerates the leading "1st"/"1." garbling into a short run of digits/I/l (observed: "13
        // Auflage", the period misread as a second digit) -- ported verbatim from label_setcodes.py's
        // `_LEAD`. Only used by the Romance-language FIRST patterns below; AUFLAGE/EDITION carry no
        // such prefix requirement at all (see class doc).
        private const val LEAD = "[0-9IlL]{1,3}\\.?\\s*"

        // AUflagE with the F and trailing E wildcarded -- ported verbatim from label_setcodes.py's
        // `_AUFLAGE`, still anchored by 5 literal letters.
        private const val AUFLAGE = "AU.LAG."

        // Gemessen am 20.09.2026 an 40 echten Zonenlesungen aus der Halterung (Detektor + EDITION-Zone
        // + OcrPrep.enhance am PC nachgebaut, ueber ml/data/scanlog + stapel_fotos): die beiden Muster
        // darueber erkannten 3 davon. Was die OCR hier liefert, ist einen Schritt kaputter, als die
        // eBay-Fotos es nahelegten -- "AUFLA", "AUSLAE", "AUTLAS" (G und E zerfallen BEIDE, nicht nur
        // eines) und "EDFDOU", "EDHUOP" (duenne Serifenschrift der Folienzeile: i->f, t->d, i->u).
        // Diese zwei Muster fangen sie und heben die Erkennung auf 8 von 40.
        //
        // Die WORTGRENZE ist der ganze Trick, nicht Zierde: ohne sie trifft AU.LA auch
        // "Elementaraufladung", "Batterieaufladegeraet" und "Traumland". Mit ihr kostet die Toleranz
        // im echten Kartenkorpus (43.698 deutsche und englische Namen + Kartentexte aus dem
        // Offline-Katalog) 14 statt 6 moegliche Falschtreffer, also 0,032 % statt 0,014 %.
        // Bemerkenswert: die 6 von heute gehen auf "EDITION" selbst zurueck, das in "Galaxy
        // Expedition" steckt -- die tolerante Variante mit Wortgrenze ist dort SAUBERER.
        private const val EDITION_ZERFALLEN = "\\bED.{1,2}O"
        private const val AUFLAGE_ZERFALLEN = "\\bAU.LA"

        private val FIRST_PATTERNS = listOf(
            Regex("EDITION"),
            Regex(AUFLAGE),
            Regex(EDITION_ZERFALLEN),
            Regex(AUFLAGE_ZERFALLEN),
            Regex(LEAD + "A\\s*EDICION"),
            Regex(LEAD + "ERE\\s*EDITION"),
            Regex(LEAD + "A\\s*EDIZIONE"),
            Regex(LEAD + "A\\s*EDICAO"),
        )

        private val LIMITED_PATTERNS = listOf(
            Regex("LIMITED\\s*EDITION"),
            Regex("LIMITIERTE\\s*$AUFLAGE"),
            // Mitgezogen, damit die Reihenfolge traegt: LIMITED wird VOR FIRST geprueft, damit
            // FIRSTs blosses "EDITION"/"AU.LAG." eine limitierte Karte nicht als erste Auflage
            // ausweist. Waere nur FIRST toleranter geworden, traefe dieselbe Zerfallsstufe auf
            // einer "LIMITIERTE AUFLAGE" jetzt FIRST, bevor LIMITED ueberhaupt greift.
            Regex("LIMITED\\s*" + EDITION_ZERFALLEN),
            Regex("LIMITIERTE\\s*" + AUFLAGE_ZERFALLEN),
            Regex("EDICION\\s*LIMITADA"),
            Regex("EDITION\\s*LIMITEE"),
        )

        // NFKD + drop combining marks -- same normalisation label_setcodes.py's `_strip_accents`
        // does via `unicodedata`. Also folds the ordinal indicator "ª" ("1ª Edicion") down to a
        // plain "a": NFKD gives it a compatibility decomposition to U+0061.
        private fun normalize(text: String): String {
            val decomposed = Normalizer.normalize(text, Normalizer.Form.NFKD)
            val stripped = decomposed.filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }
            return stripped.uppercase()
        }
    }

    private var firstFrames = 0
    private var limitedFrames = 0
    private var legibleFrames = 0

    /**
     * Record one frame's already-OCR'd EDITION-zone text. Call this ONLY when the zone was
     * actually cropped and OCR'd for this card's layout -- see the class doc on why a layout with
     * no measured EDITION zone must never call this at all.
     *
     * Spec D3 fix I1: [zoneText] only counts towards `legibleFrames` -- and so towards the
     * `unlimited` rule in [result] -- when it is actually non-blank. This class used to count a
     * blank [zoneText] as "provably empty, we looked and found nothing" evidence, on the theory
     * that a real, no-marker crop and an OCR failure both mean "no marker seen". They don't: OCR
     * on a badly-placed crop (box slightly large, glare, a placeholder rectangle) also returns "",
     * and that case is NOT "we confirmed this spot is blank" -- it is "we never actually read this
     * spot at all". Treating it as legible let three such frames alone (no other evidence) fabricate
     * `unlimited` at HIGH confidence, which -- since detection beats the default-edition setting
     * (Spec Section 7, see [ScanConfidence.resolveEdition]) -- silently overwrote a 1st-edition
     * card's user-set `first` default. `isNotBlank()` is the fix: legibility now requires OCR to
     * have actually produced characters, marker or not, exactly as this function's own name
     * ("legible") already implied but did not enforce. This is why the unlimited rule hangs on THIS
     * zone being legible and not, say, the passcode line being legible elsewhere on the same frame:
     * D2 measured PASSCODE at 91.4% legibility against SET_CODE at 53.8% on the same corpus, so one
     * zone's success says nothing about another's.
     */
    fun add(zoneText: String) {
        if (zoneText.isNotBlank()) legibleFrames++
        val norm = normalize(zoneText)
        when {
            LIMITED_PATTERNS.any { it.containsMatchIn(norm) } -> limitedFrames++
            FIRST_PATTERNS.any { it.containsMatchIn(norm) } -> firstFrames++
        }
    }

    /**
     * `first`/`limited` win as soon as their marker was read on even one frame (LOW confidence at
     * 1, HIGH at >=2 -- see [confidenceFor]). Failing that, `unlimited` needs the EDITION zone
     * itself legible on >=2 frames with no marker anywhere (LOW at exactly 2, HIGH at >=3).
     * Otherwise `unknown` -- either nothing was ever recorded (no measured zone for this layout,
     * or the card simply wasn't scanned), or exactly one legible, markerless frame, which is not
     * enough to conclude "unlimited" rather than "we just haven't seen the marker yet".
     *
     * Spec §7, verbatim: if the user's default edition (Spec A) is `first` and this returns
     * `unlimited` with HIGH confidence, detection wins -- the card beats the setting. That merge
     * with the Spec A default is Task 5's job (the traffic light), not this class's: this class
     * only ever reports what the EDITION zone itself says.
     */
    fun result(): EditionResult {
        if (limitedFrames > 0) return EditionResult("limited", confidenceFor(limitedFrames))
        if (firstFrames > 0) return EditionResult("first", confidenceFor(firstFrames))
        if (legibleFrames >= 2) {
            return EditionResult("unlimited", if (legibleFrames >= 3) Confidence.HIGH else Confidence.LOW)
        }
        return EditionResult("unknown", Confidence.LOW)
    }

    private fun confidenceFor(frames: Int) = if (frames >= 2) Confidence.HIGH else Confidence.LOW
}
