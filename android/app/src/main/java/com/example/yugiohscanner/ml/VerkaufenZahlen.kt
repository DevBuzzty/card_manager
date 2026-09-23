package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.ListingsData

/**
 * Spec I §5.3 / Abschlussreview C1 -- Anzahlen der vier Verkaufen-Reiter. ZWILLING von
 * desktop/src/utils/verkaufenCounts.js (gleiche Definition). null heisst "laedt noch": dann steht keine
 * Zahl hinter dem Namen, nie eine falsche 0.
 * - kandidaten: Anzahl der Duplikat-Gruppen.
 * - zum-verkauf: vorgemerkte Exemplare, die in keinem aktiven Angebot stecken (wie nav-counts.forSale).
 * - angebote: aktive Angebote (wie nav-counts.listingsOpen).
 * - verkaeufe: gebuchte, nicht stornierte Verkaeufe.
 */
object VerkaufenZahlen {
    fun zahlen(
        duplicateGroups: Int?,
        forSaleIds: Set<String>?,
        listings: ListingsData?,
        sales: List<SalesMath.SaleHead>?,
    ): Map<String, Int?> {
        val imAngebot = listings?.byCopy()?.keys
        return mapOf(
            "kandidaten" to duplicateGroups,
            "zum-verkauf" to if (forSaleIds == null || imAngebot == null) null else forSaleIds.count { it !in imAngebot },
            "angebote" to listings?.listings?.count { it.status == "aktiv" && !it.deleted },
            "verkaeufe" to sales?.count { it.status == "aktiv" && !it.deleted },
        )
    }
}
