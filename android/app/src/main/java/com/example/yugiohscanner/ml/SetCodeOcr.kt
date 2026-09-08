package com.example.yugiohscanner.ml

import java.util.Locale
import java.util.regex.Pattern

/**
 * Set-code extraction from already-recognised OCR text. Identification now reads each card's
 * bottom band once per frame (see HybridPipeline) and pools the raw text for voting, so this no
 * longer does its own ML Kit pass — it just pulls set-code-shaped tokens out of that text.
 */
object SetCodeOcr {
    // PREFIX-REGION[VARIANT]NUMBER, e.g. LOB-EN001, DOOD-DE038, LOB-G005 (single-letter region --
    // German used just "G" before the "DE" era), SGX3-DEA10 (Speed Duel: a variant letter sits
    // between the region and the number). PREFIX stays a generic 2-5 char alnum run because real
    // prefixes legitimately end in digits (RA01, SGX3), so grammar alone can't tell those apart
    // from a misread letter -- see the correction note on VARIANT_AS_DIGIT below for the one place
    // this pattern DOES resolve that ambiguity. REGION is 1-2 letters (accepts single-letter "G");
    // an optional single VARIANT letter follows; NUMBER is 2-4 digits. This still requires the
    // hyphen plus a trailing digit run, so ordinary prose (no hyphen, no digits) never matches.
    private val SET_CODE: Pattern = Pattern.compile(
        "\\b([A-Z0-9]{2,5})-([A-Z]{1,2})([A-Z])?(\\d{2,4})\\b"
    )

    // The single letter between region and number is structurally ambiguous: it's either a real
    // variant letter (the "A" in SGX3-DEA10) or a misread leading digit of the number. Evidenced
    // on real device captures: 'O' for '0' and 'Y' for '1'. Deliberately narrow -- reusing
    // OcrText's full digit-confusion table here would also fold 'A' into '4' and corrupt genuine
    // variant letters like SGX3-DEA10's.
    private val VARIANT_AS_DIGIT = mapOf('O' to '0', 'Y' to '1')

    /** Every set-code-shaped token in [text], grammar-corrected (first-seen order, deduped). */
    fun extract(text: String): List<String> {
        val codes = LinkedHashSet<String>()
        val m = SET_CODE.matcher(text.uppercase(Locale.ROOT))
        while (m.find()) {
            val prefix = m.group(1)
            val region = m.group(2)
            val variant = m.group(3)
            val digits = m.group(4)
            val numberPart = if (variant != null) {
                (VARIANT_AS_DIGIT[variant[0]]?.toString() ?: variant) + digits
            } else digits
            codes.add("$prefix-$region$numberPart")
        }
        return codes.toList()
    }
}
