package com.example.yugiohscanner.cloud

import java.util.Locale

/**
 * eBay „zuletzt verkauft" E1 §8 -- Anzeigezeile im Karten-Detail. ZWILLING: desktop/src/utils/ebaySold.js,
 * gemeinsame Fixture docs/fixtures/ebay/sold-line.json. Datum aus den ersten 10 Zeichen des ISO-Textes (UTC-Tag).
 */
object EbaySold {
    data class Sale(val title: String, val price: Double, val soldAt: String, val url: String?, val first: Boolean)
    data class SoldRow(
        val status: String, val medianAll: Double?, val nAll: Int, val medianFirst: Double?, val nFirst: Int,
        val lastSoldAt: String?, val sales: List<Sale>,
    )

    private fun eur(v: Double) = String.format(Locale.GERMANY, "%,.2f €", v)
    private fun dayMonth(iso: String?) = if (iso != null && iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}." else null

    fun line(access: String, row: SoldRow?): String {
        if (access == "fehlt") return "eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet"
        if (row == null) return "eBay: noch nicht geprüft"
        if (row.status == "fehler") return "eBay: Abruf fehlgeschlagen"
        val median = row.medianAll
        if (row.status != "ok" || median == null) return "eBay: zu wenig Verkäufe (${row.nAll})"
        val sb = StringBuilder("eBay verkauft: ${eur(median)} · ${row.nAll} Verkäufe")
        dayMonth(row.lastSoldAt)?.let { sb.append(" · zuletzt $it") }
        row.medianFirst?.let { sb.append(" · 1. Aufl. ${eur(it)} (${row.nFirst})") }
        return sb.toString()
    }

    fun canCheck(access: String) = access != "fehlt"
}
