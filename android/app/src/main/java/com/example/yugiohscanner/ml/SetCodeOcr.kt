package com.example.yugiohscanner.ml

import java.util.Locale
import java.util.regex.Pattern

/**
 * Set-code extraction from already-recognised OCR text. Identification now reads each card's
 * bottom band once per frame (see HybridPipeline) and pools the raw text for voting, so this no
 * longer does its own ML Kit pass — it just pulls set-code-shaped tokens out of that text.
 */
object SetCodeOcr {
    // PREFIX-<2-letter region><digits>, e.g. LOB-EN001, DOOD-DE038.
    private val SET_CODE: Pattern = Pattern.compile("\\b[A-Z0-9]{2,5}-[A-Z]{2}\\d{2,4}\\b")

    /** Every set-code-shaped token in [text] (first-seen order preserved, deduped). */
    fun extract(text: String): List<String> {
        val codes = LinkedHashSet<String>()
        val m = SET_CODE.matcher(text.uppercase(Locale.ROOT))
        while (m.find()) codes.add(m.group())
        return codes.toList()
    }
}
