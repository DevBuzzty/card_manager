package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.ListingsData

/**
 * Spec I §5.3 / Abschlussreview C1 -- Anzahlen der vier Verkaufen-Reiter. ZWILLING von
 * desktop/src/utils/verkaufenCounts.js (gleiche Definition). null heisst "laedt noch": dann steht keine
 * Zahl hinter dem Namen, nie eine falsche 0. Restrunde 2: die Zahl zeigt genau, was die Liste im
 * Standardzustand zeigt.
 * - kandidaten: Anzahl der Duplikat-Gruppen.
 * - zum-verkauf: alle vorgemerkten, lebenden Exemplare (wie Duplicates.forSaleSummary / Kopfzeile der
 *   Liste), INKLUSIVE der Exemplare in aktiven Angeboten.
 * - angebote: aktive Angebote.
 * - verkaeufe: Eintraege der Verkaufsliste im Standard-Zeitraum [SALES_DEFAULT_PERIOD], Stornos eingeschlossen.
 */
object VerkaufenZahlen {
    const val SALES_DEFAULT_PERIOD = "monat"

    fun zahlen(
        duplicateGroups: Int?,
        forSaleIds: Set<String>?,
        listings: ListingsData?,
        sales: List<SalesMath.SaleHead>?,
        today: String,
    ): Map<String, Int?> = mapOf(
        "kandidaten" to duplicateGroups,
        "zum-verkauf" to forSaleIds?.size,
        "angebote" to listings?.listings?.count { it.status == "aktiv" && !it.deleted },
        "verkaeufe" to sales?.let { SalesMath.periodFilter(it, SALES_DEFAULT_PERIOD, today).size },
    )
}
