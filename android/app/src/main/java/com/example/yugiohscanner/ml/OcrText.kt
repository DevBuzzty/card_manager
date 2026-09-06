package com.example.yugiohscanner.ml

/**
 * OCR post-processing for the 8-digit passcode. ML Kit mis-reads small print (O->0, I/l->1, B->8,
 * S->5, ...). We correct those confusions, but ONLY inside a token that already looks like a
 * passcode (mostly digits), so real words aren't mangled into false 8-digit matches.
 */
object OcrText {
    private val confuse = mapOf(
        'O' to '0', 'o' to '0', 'Q' to '0', 'D' to '0',
        'I' to '1', 'l' to '1', '|' to '1', 'i' to '1',
        'Z' to '2', 'z' to '2',
        'E' to '3',
        'A' to '4',
        'S' to '5', 's' to '5',
        'G' to '6', 'b' to '6',
        'T' to '7',
        'B' to '8',
        'g' to '9', 'q' to '9',
    )

    /**
     * First 8-digit passcode in [text], correcting near-miss letter/digit confusions.
     *
     * [exists] gates only the correction pass (step 2): an aggressive letter->digit fix can turn
     * noise into an 8-digit run that looks plausible but was never a real card, so that pass only
     * accepts a correction the catalog actually recognises (Spec D §7c). The exact-digits fast
     * path (step 1) needs no such check -- it never rewrites anything. Defaults to always-true so
     * a caller with no catalog wired up keeps today's unconditional behaviour; production callers
     * should pass a real lookup (e.g. `{ CatalogRepository.card(it) != null }`).
     */
    fun findPasscode(text: String, exists: (String) -> Boolean = { true }): Int? {
        // 1) exact 8-digit run anywhere (fast path, no correction risk)
        Regex("\\d{8}").find(text)?.let { return it.value.toIntOrNull() }
        // 2) correction pass on passcode-like tokens, validated against the catalog
        for (tok in text.split(Regex("[^A-Za-z0-9|]+"))) {
            if (tok.length < 8) continue
            if (tok.count { it.isDigit() } < 6) continue          // already mostly digits
            val fixed = tok.map { confuse[it] ?: it }.joinToString("")
            val match = Regex("\\d{8}").find(fixed) ?: continue
            if (exists(match.value)) return match.value.toIntOrNull()
        }
        return null
    }
}
