package com.example.yugiohscanner.cloud

// Constrained set-code recognition: the artwork embedder already told us WHICH card this is,
// so the set code can only be one of that card's known printings. We correct the noisy OCR
// to the nearest known set code (Levenshtein) instead of trusting free-text OCR.
object SetCodeMatch {
    private fun norm(s: String) = s.uppercase().filter { it.isLetterOrDigit() || it == '-' }

    private fun lev(a: String, b: String): Int {
        val m = a.length; val n = b.length
        if (m == 0) return n
        if (n == 0) return m
        val prev = IntArray(n + 1) { it }
        val cur = IntArray(n + 1)
        for (i in 1..m) {
            cur[0] = i
            for (j in 1..n) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            System.arraycopy(cur, 0, prev, 0, n + 1)
        }
        return prev[n]
    }

    /** Best known printing for the OCR candidates, or null if nothing is close enough.
     *  `known` should be German-first so a tie prefers the German printing. */
    fun best(ocr: List<String>, known: List<SetOption>): SetOption? {
        if (known.isEmpty() || ocr.isEmpty()) return null
        var best: SetOption? = null
        var bestD = Int.MAX_VALUE
        for (raw in ocr) {
            val c = norm(raw)
            if (c.length < 4) continue
            for (k in known) {
                val d = lev(c, norm(k.setCode))
                if (d < bestD) { bestD = d; best = k }
            }
        }
        // Set codes are ~8-10 chars; accept exact/near reads, reject far ones.
        return if (best != null && bestD <= 2) best else null
    }
}
