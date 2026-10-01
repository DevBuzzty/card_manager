package com.example.yugiohscanner.ml

/**
 * Sprach-Schalter des Scanners (Spec koreanische Karten §3.2). `null` = Automatisch.
 * Bewusst nur im Speicher: nach einem App-Neustart gilt wieder Auto, damit ein koreanischer Stapel
 * nicht am naechsten Tag deutsche Karten als KR bucht.
 */
object ScanSprache {
    val OPTIONEN: List<String?> = listOf(null, "DE", "EN", "KR", "JP")

    @Volatile var fest: String? = null

    /** Standard-Region einer Sprache fuer einen zusammengesetzten Code (CORI-EN001 -> CORI-KR001). */
    fun region(sprache: String): String = sprache

    /**
     * Druck fuer einen Scan, dessen Set-Code nicht lesbar war (Abnahme 01.10.2026: sonst buchte das Handy
     * trotz fester Sprache KR als DE). Erster bekannter Druck der festen Sprache, verifizierte zuerst --
     * Zwilling der PC-Regel `fixedLanguageSet` (desktop/src/utils/setCodeMatch.js); ohne bekannten Druck
     * der Sammelbehaelter "Unknown" in dieser Sprache. `null` bei Auto.
     */
    fun ersatzDruck(fest: String?, known: List<com.example.yugiohscanner.cloud.SetOption>): com.example.yugiohscanner.cloud.SetOption? {
        if (fest == null) return null
        return known.filter { it.language.equals(fest, ignoreCase = true) }.sortedByDescending { it.verified }.firstOrNull()
            ?: com.example.yugiohscanner.cloud.SetOption("Unknown", "Unknown", 0.0, fest)
    }
}
