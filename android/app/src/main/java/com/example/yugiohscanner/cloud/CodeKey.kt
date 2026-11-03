package com.example.yugiohscanner.cloud

/**
 * Spec 2026-11-03 §3.2 -- Set-Praefix + Nummer ohne Region und ohne fuehrende Nullen ("LOB-DE005" -> "LOB-5").
 * Leitet nur die Cardmarket-Zuordnung her, nie einen Set-Code. Region ist optional ("LOB-005" -> "LOB-5").
 * Twin: supabase/functions/_shared/code-key.ts, Fixture docs/fixtures/code-key.json.
 */
object CodeKey {
    private val muster = Regex("^([A-Z0-9]{2,6})-([A-Z]{1,2})?([A-Z]?\\d{1,4})$")

    fun of(code: String): String? {
        val m = muster.matchEntire(code.trim().uppercase(java.util.Locale.ROOT)) ?: return null
        val nummer = m.groupValues[3].trimStart('0').ifEmpty { "0" }
        return m.groupValues[1] + "-" + nummer
    }
}
