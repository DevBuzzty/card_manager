package com.example.yugiohscanner.ml

import java.util.Locale

/**
 * Reads a set code's REGION infix (the "DE" in `LOB-DE005`) straight from the card's own OCR
 * text, independently of any catalog lookup. This is Spec D3's structural fix for the defect
 * found in D1: matching a whole code like `LOB-EN005` against a known printing `LOB-DE005`
 * costs only 2 of 8 characters under a fuzzy-match tolerance of 2, so an English printing was
 * silently accepted for a German card. Splitting into prefix / region / number and reading the
 * region SEPARATELY closes that hole -- but only if a wrong read is refused rather than guessed.
 * Hence the whole contract: ambiguous or unreadable input returns `null`, never a best-effort
 * region. Better nothing than the wrong thing.
 *
 * [read] takes the prefix and number as already-established/expected values (e.g. the clean
 * `numberPart` [SetCodeOcr.extract] would produce -- variant letters folded in via
 * [SetCodeOcr.VARIANT_AS_DIGIT] where that map applies, kept literal otherwise, exactly like
 * `SGX3-DEA10`'s "A") and locates the matching PREFIX-...-NUMBER span in the raw, noisy
 * [zoneText] itself, tolerating the OCR confusions this codebase already knows. What sits
 * between prefix and number in that span is the region candidate.
 */
object RegionToken {

    // The real region infixes this project has to recognise. Evidence, not invention:
    //  - DE, G                : PrintingRepository.germanCode ("-DE|-G\\d") -- G is the pre-2003
    //                           single-letter German infix (e.g. "TP1-G015", also LOB-G005 /
    //                           SDY-G005 / TSC-G003 in SetCodeOcrTest's real corpus).
    //  - EN, FR, IT, PT, SP,
    //    KR, AE               : PrintingRepository.foreignForJp ("-(EN|DE|FR|IT|PT|SP|KR|AE|EU)\\d").
    //  - E, F, I, S, P        : the single-letter predecessors of EN/FR/IT/SP/PT, from the SAME
    //                           pre-2003 TCG print era that produced "G" for German (LOB/MRD/SRL
    //                           era sets carry single-letter regions across every TCG language,
    //                           not just German -- G is merely the one this project's own corpus
    //                           happens to evidence directly).
    //  - JP, JA               : PrintingRepository tags Japanese prints "JP" and passes the wiki
    //                           locale "ja" (see `if (tag == "JP") "ja" else "de"` and the
    //                           `'de'|'ja'|'en'` locale comment).
    //  - TC, SC               : Konami's Traditional/Simplified Chinese OCG-Asia region infixes
    //                           (e.g. "MP23-TC001") -- not yet exercised by this project's own
    //                           corpus, but real Konami-issued codes, kept for completeness per
    //                           the task brief's list.
    val KNOWN: Set<String> = setOf(
        "DE", "G", "EN", "E", "FR", "F", "IT", "I", "SP", "S", "PT", "P",
        "JP", "JA", "KR", "AE", "TC", "SC"
    )

    // Spec D3 fix C1: a REGION INFIX is not a language code -- `language` is part of the collection's
    // composite primary key (CollectionRepository.addScanned -> getRow(id, setCode, language,
    // rarity)) and every reader of it (LangFlag.langFlag, CollectionRepository, CardSearchRepository)
    // only ever expects "DE"/"EN"/"JP". Writing a raw region like "G" or "F" into that column used to
    // create a second, invisible row for the same physical card -- no flag, no DE-first handling, no
    // merge with the user's real DE rows. [language] maps a region infix to the value the rest of the
    // app understands, reusing PrintingRepository's OWN classification rather than inventing a second
    // one:
    //  - DE, G  -> "DE"  (PrintingRepository.germanCode: "-DE|-G\d" tags a printing "DE")
    //  - JP, JA -> "JP"  (PrintingRepository tags Japanese printings "JP", passes wiki locale "ja")
    //  - everything else (EN, E, FR, F, IT, I, SP, S, PT, P, KR, AE, TC, SC) has no language slot of
    //    its own anywhere in this app -- PrintingRepository.fetchSets already collapses EVERY
    //    non-German, non-Japanese network hit into "EN" regardless of its real region infix (see its
    //    `SetOption(code, rarity, price, "EN")`, applied to French/Italian/Spanish/... codes alike).
    //    Mapping them here to "EN" reuses that exact, already-shipped collapse instead of drawing a
    //    new line this app has nowhere to put.
    fun language(region: String): String = when (region.uppercase(Locale.ROOT)) {
        "DE", "G" -> "DE"
        "JP", "JA" -> "JP"
        else -> "EN"
    }

    // The confusion table the brief points at (0/O, 1/I/l, 5/S, 8/B), used to locate the prefix
    // and number spans in noisy OCR text -- e.g. recognising that zoneText's "L0B" is really the
    // expected prefix "LOB", or that "0O5" is really "005". Symmetric so either side can be the
    // "clean" one.
    //
    // "Y" is added beyond those four pairs for exactly one documented reason: SetCodeOcr's own
    // VARIANT_AS_DIGIT already treats a misread 'Y' as '1' in the single slot right after the
    // region (SetCodeOcrTest pins "L5DD-DEY25" -> "L5DD-DE125"), so a `number` built from that
    // extraction ("125") would otherwise never fuzzy-match this project's own real "...DEY25"
    // captures. This is reuse of an existing, narrow, already-evidenced correction -- not a new
    // one invented for this file.
    private val CONFUSE = hashSetOf(
        "O0", "0O", "I1", "1I", "L1", "1L", "S5", "5S", "B8", "8B", "Y1", "1Y"
    )

    private fun fuzzyEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        for (i in a.indices) {
            val x = a[i]
            val y = b[i]
            if (x == y) continue
            if (!CONFUSE.contains("$x$y")) return false
        }
        return true
    }

    // THE judgement call this task calls out explicitly: DIFO-DFO19 is a real device capture of
    // DIFO-DE019, the region's 'E' misread as 'F' -- visually the two glyphs differ only by the
    // bottom stroke, which is exactly the kind of stroke that gets lost at this print size.
    //
    // Decision: accept a SINGLE E<->F swap, pinned by `region E-F Verwechslung wird aufgeloest`
    // below. Justification for going further than pure digit/letter confusion:
    //  - It is narrow (one letter pair, not a general letter-confusion table), so it cannot fold
    //    unrelated regions into each other the way reusing OcrText.CONFUSE wholesale would.
    //  - It only ever fires when the token is NOT already a known region (see [classify] below),
    //    so a clean "DE" or "EN" reading is never touched by it.
    //  - It still refuses to guess: if flipping E<->F could land on two DIFFERENT known regions,
    //    or if the token was already valid without flipping, ambiguity/exactness wins over the
    //    swap (see `ambigue Region liefert null` and the exact-match short-circuit in [classify]).
    // The alternative -- reject E/F entirely -- is equally defensible (never invent a region from
    // a corrected letter), but throws away a reading this project's own corpus actually produced.
    // Given the whole point of D3 is recovering the region reliably, the recovery is taken, with
    // this comment as the record of the trade-off.
    private fun classify(token: String): String? {
        if (token in KNOWN) return token
        val flips = LinkedHashSet<String>()
        for (i in token.indices) {
            val swapped = when (token[i]) {
                'E' -> 'F'
                'F' -> 'E'
                else -> null
            } ?: continue
            val candidate = token.substring(0, i) + swapped + token.substring(i + 1)
            if (candidate in KNOWN) flips.add(candidate)
        }
        return flips.singleOrNull()
    }

    // PREFIX-TAIL, generously: PREFIX may embed digits (RA01, SGX3), TAIL is region+number+
    // optional variant letter, still alphanumeric because OCR digit/letter noise lives inside it.
    private val CODE_SPAN = Regex("([A-Z0-9]{2,6})-([A-Z0-9]{3,8})")

    /**
     * The region token between [prefix] and [number] as read from [zoneText], or `null` if it
     * can't be pinned down unambiguously. Every occurrence of a prefix-tail span in [zoneText]
     * that matches [prefix] (fuzzily) is tried, at every plausible region length (1-3, mirroring
     * `ml/measure_zones_photos.py`'s `code_key`); each one that leaves a remainder fuzzily equal
     * to [number] yields a region candidate. Exactly one distinct candidate across ALL of that ->
     * return it. Zero, or more than one (e.g. [zoneText] pools two frames' readings and they
     * disagree, one reading "...-DE005" and the other "...-EN005") -> `null`.
     */
    fun read(zoneText: String, prefix: String, number: String): String? {
        val upper = zoneText.uppercase(Locale.ROOT)
        val expectedPrefix = prefix.uppercase(Locale.ROOT)
        val expectedNumber = number.uppercase(Locale.ROOT)

        val found = LinkedHashSet<String>()
        for (m in CODE_SPAN.findAll(upper)) {
            val foundPrefix = m.groupValues[1]
            if (!fuzzyEquals(foundPrefix, expectedPrefix)) continue

            val tail = m.groupValues[2]
            val maxRegionLen = minOf(3, tail.length - 1)
            for (k in 1..maxRegionLen) {
                val regionCandidate = tail.substring(0, k)
                if (!regionCandidate.all { it.isLetter() }) continue
                val rest = tail.substring(k)
                if (!fuzzyEquals(rest, expectedNumber)) continue
                val region = classify(regionCandidate) ?: continue
                found.add(region)
            }
        }
        return found.singleOrNull()
    }
}
