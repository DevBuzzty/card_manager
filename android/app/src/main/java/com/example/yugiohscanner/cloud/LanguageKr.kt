package com.example.yugiohscanner.cloud

/**
 * Koreanische Karten (Spec 2026-10-01). ZWILLING: desktop/electron/language-kr.cjs.
 * Gemeinsame Fixture: docs/fixtures/language/kr.json. Wer eine Fassung aendert, aendert beide.
 */
object LanguageKr {
    const val DEFAULT_FACTOR = 0.5

    // KR-Region ("CORI-KR001", "MVP1-KRQ54") oder das alte einzelne K ("LOB-K005") direkt vor der Nummer.
    private val KOREAN_CODE = Regex("""-KR?[A-Z]?\d""", RegexOption.IGNORE_CASE)
    fun isKoreanCode(code: String): Boolean = KOREAN_CODE.containsMatchIn(code)

    /** Preis x Sprachfaktor, auf Cent gerundet (+1e-7 wie am PC, damit 0.075 auf 0.08 rundet). */
    fun applyFactor(price: Double?, factor: Double?): Double? {
        if (price == null) return null
        if (factor == null) return price
        return Math.round(price * factor * 100 + 1e-7) / 100.0
    }

    private val KO_NAME = Regex("""^\|\s*ko_name\s*=[ \t]*(.*)$""", RegexOption.MULTILINE)
    private val TAG = Regex("<[^>]+>")
    fun extractKoName(wikitext: String): String? =
        KO_NAME.find(wikitext)?.groupValues?.get(1)?.replace(TAG, "")?.trim()?.ifEmpty { null }

    private val TITLE = Regex("""<title>\s*([^|<]+?)\s*\|""")
    fun konamiTitleName(html: String): String? = TITLE.find(html)?.groupValues?.get(1)
}
