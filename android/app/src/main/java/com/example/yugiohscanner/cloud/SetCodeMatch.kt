package com.example.yugiohscanner.cloud

// Constrained set-code recognition. The card's identity (passcode) is already known, so its set
// code can ONLY be one of that card's known printings — a small, closed list. Instead of trusting
// a clean `XXX-DE123` token to survive OCR (it often doesn't: the hyphen is dropped, digits are
// confused, the code is split across a line break), we match each KNOWN printing against the raw
// OCR evidence, separators stripped, using a confusion-weighted edit distance, and keep the best.
object SetCodeMatch {
    // Keep only A-Z0-9 (OCR frequently loses the hyphen and spaces), uppercased.
    private fun norm(s: String) = s.uppercase().filter { it.isLetterOrDigit() }

    // Symmetric OCR confusions cost 0.5 instead of a full substitution.
    private val CONFUSE = hashSetOf(
        "O0", "0O", "I1", "1I", "L1", "1L", "S5", "5S", "B8", "8B", "Z2", "2Z",
        "D0", "0D", "G6", "6G", "T7", "7T", "Q0", "0Q", "A4", "4A"
    )

    private fun subCost(a: Char, b: Char): Float =
        if (a == b) 0f else if ("$a$b" in CONFUSE) 0.5f else 1f

    // Confusion-weighted Levenshtein between two short strings.
    private fun dist(a: String, b: String): Float {
        val m = a.length; val n = b.length
        val prev = FloatArray(n + 1) { it.toFloat() }
        val cur = FloatArray(n + 1)
        for (i in 1..m) {
            cur[0] = i.toFloat()
            for (j in 1..n) {
                cur[j] = minOf(cur[j - 1] + 1f, prev[j] + 1f, prev[j - 1] + subCost(a[i - 1], b[j - 1]))
            }
            System.arraycopy(cur, 0, prev, 0, n + 1)
        }
        return prev[n]
    }

    // Smallest weighted distance aligning `code` anywhere inside `hay` (both normalized). Tries
    // window lengths L-1..L+1 to tolerate an inserted/dropped character. Cheap: codes are ~8-10
    // chars and the band text is short.
    private fun bestWindowDist(code: String, hay: String): Float {
        val L = code.length
        var best = Float.MAX_VALUE
        for (len in (L - 1)..(L + 1)) {
            if (len < 3 || len > hay.length) continue
            var s = 0
            while (s + len <= hay.length) {
                val d = dist(code, hay.substring(s, s + len))
                if (d < best) best = d
                s++
            }
        }
        return best
    }

    private val GERMAN = Regex("""-DE|-G\d""", RegexOption.IGNORE_CASE)
    private fun isGerman(code: String) = GERMAN.containsMatchIn(code)

    /**
     * Best known printing for the raw OCR [evidence] (one string per frame/read), or null if
     * nothing is close enough. [known] should be German-first so a tie prefers the German printing.
     * Passing already-clean codes still works — they align at distance 0.
     */
    fun best(evidence: List<String>, known: List<SetOption>): SetOption? {
        if (known.isEmpty() || evidence.isEmpty()) return null
        val hay = norm(evidence.joinToString(" "))
        if (hay.length < 4) return null

        var best: SetOption? = null
        var bestScore = Float.MAX_VALUE
        var bestRaw = Float.MAX_VALUE
        for (k in known) {
            val code = norm(k.setCode)
            if (code.length < 4) continue
            val d = bestWindowDist(code, hay)
            // Nudge German printings ahead on ties (the known list is already DE-first, this just
            // makes it explicit and robust to ordering).
            val score = d - if (isGerman(k.setCode)) 0.1f else 0f
            if (score < bestScore) { bestScore = score; bestRaw = d; best = k }
        }

        // Accept only a close-enough match; the tolerance scales with code length.
        val code = best?.let { norm(it.setCode) } ?: return null
        val tolerance = maxOf(1.5f, 0.25f * code.length)
        return if (bestRaw <= tolerance) best else null
    }
}
