package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListingItemRow
import com.example.yugiohscanner.cloud.ListingRow
import com.example.yugiohscanner.cloud.ListingsData
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.VerkaufenZahlen
import com.example.yugiohscanner.ui.NavTabellen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ZWILLING von desktop/src/utils/verkaufenCounts.test.js (dieselbe Definition je Reiter). */
class VerkaufenZahlenTest {
    private fun listing(id: String, status: String, deleted: Boolean = false) =
        ListingRow(id, "k", "Kanal", null, null, 1.0, status, "2026-09-01", null, null, null, null, deleted)
    private fun item(listingId: String, copyId: String) =
        ListingItemRow(listingId, copyId, "1", "LOB-DE001", "DE", "Common", "unknown", "NM", null, null, false)
    private fun sale(id: String, soldOn: String, status: String) =
        SalesMath.SaleHead(id, soldOn, "k", "Kanal", 1.0, null, null, status, false)

    @Test
    fun eineZahlJeReiterWieDieListeImStandardzustand() {
        val listings = ListingsData(
            listOf(listing("L1", "aktiv"), listing("L2", "beendet"), listing("L3", "aktiv", deleted = true)),
            listOf(item("L1", "c1"), item("L2", "c2")),
        )
        val sales = listOf(sale("S1", "2026-09-03", "aktiv"), sale("S2", "2026-09-10", "storniert"), sale("S3", "2026-08-30", "aktiv"))
        val z = VerkaufenZahlen.zahlen(3, setOf("c1", "c2", "c3"), listings, sales, "2026-09-23")
        // Restrunde 2: c1 steckt im aktiven Angebot L1 und zaehlt trotzdem (wie die Kopfzeile der Liste);
        // Verkaeufe = Eintraege im Monat samt Storno, der August-Verkauf nicht.
        assertEquals(mapOf("kandidaten" to 3, "zum-verkauf" to 3, "angebote" to 1, "verkaeufe" to 2), z)
        assertEquals(NavTabellen.VERKAUFEN.map { it.first }.sorted(), z.keys.sorted())
    }

    @Test
    fun solangeEineQuelleLaedtStehtDortNull() {
        val z = VerkaufenZahlen.zahlen(null, null, null, null, "2026-09-23")
        assertEquals(mapOf<String, Int?>("kandidaten" to null, "zum-verkauf" to null, "angebote" to null, "verkaeufe" to null), z)
    }

    @Test
    fun standardZeitraumIstDerDerVerkaufsliste() {
        val s = Fixtures.text("android/app/src/main/java/com/example/yugiohscanner/ui/SalesScreen.kt")
        assertTrue(s.contains("mutableStateOf(\"${VerkaufenZahlen.SALES_DEFAULT_PERIOD}\")"))
    }
}
