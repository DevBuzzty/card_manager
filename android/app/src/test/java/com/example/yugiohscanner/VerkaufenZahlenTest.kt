package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListingItemRow
import com.example.yugiohscanner.cloud.ListingRow
import com.example.yugiohscanner.cloud.ListingsData
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.VerkaufenZahlen
import com.example.yugiohscanner.ui.NavTabellen
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/verkaufenCounts.test.js (dieselbe Definition je Reiter). */
class VerkaufenZahlenTest {
    private fun listing(id: String, status: String, deleted: Boolean = false) =
        ListingRow(id, "k", "Kanal", null, null, 1.0, status, "2026-09-01", null, null, null, null, deleted)
    private fun item(listingId: String, copyId: String, deleted: Boolean = false) =
        ListingItemRow(listingId, copyId, "1", "LOB-DE001", "DE", "Common", "unknown", "NM", null, null, deleted)
    private fun sale(id: String, status: String, deleted: Boolean = false) =
        SalesMath.SaleHead(id, "2026-09-01", "k", "Kanal", 1.0, null, null, status, deleted)

    @Test
    fun eineZahlJeReiterSchluesselWieNavTabellen() {
        val listings = ListingsData(
            listOf(listing("L1", "aktiv"), listing("L2", "beendet"), listing("L3", "aktiv", deleted = true)),
            listOf(item("L1", "c1"), item("L2", "c2")),
        )
        val z = VerkaufenZahlen.zahlen(3, setOf("c1", "c2", "c3"), listings,
            listOf(sale("S1", "aktiv"), sale("S2", "storniert"), sale("S3", "aktiv"), sale("S4", "aktiv", deleted = true)))
        // c1 steckt im aktiven Angebot L1 -> zaehlt nicht bei "Zum Verkauf"; c2 nur im beendeten L2 -> zaehlt.
        assertEquals(mapOf("kandidaten" to 3, "zum-verkauf" to 2, "angebote" to 1, "verkaeufe" to 2), z)
        assertEquals(NavTabellen.VERKAUFEN.map { it.first }.sorted(), z.keys.sorted())
    }

    @Test
    fun solangeEineQuelleLaedtStehtDortNull() {
        val z = VerkaufenZahlen.zahlen(null, null, null, null)
        assertEquals(mapOf<String, Int?>("kandidaten" to null, "zum-verkauf" to null, "angebote" to null, "verkaeufe" to null), z)
        // Vorgemerkte bekannt, Angebote noch nicht geladen: "Zum Verkauf" bleibt offen statt falsch zu zaehlen.
        assertEquals(null, VerkaufenZahlen.zahlen(0, setOf("c1"), null, emptyList())["zum-verkauf"])
    }
}
