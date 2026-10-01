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
}
