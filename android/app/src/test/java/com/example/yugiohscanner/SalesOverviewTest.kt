package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SaleChannel
import com.example.yugiohscanner.cloud.SaleItemRow
import com.example.yugiohscanner.cloud.SalesData
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ml.SalesOverview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SalesOverviewTest {
    private fun head(id: String, on: String, status: String = "aktiv", channel: String = "ebay", name: String = "eBay", gross: Double = 10.0) =
        SalesMath.SaleHead(id, on, channel, name, gross, null, null, status, false)
    private fun item(sale: String, copy: String, value: Double, share: Double, card: String = "1", deleted: Boolean = false) =
        SaleItemRow(sale, copy, value, share, false, card, "X-DE001", "DE", "Common", "unknown", "NM", "Karte $card", null, deleted)
    private val channels = listOf(SaleChannel("ebay", "eBay", 0.0, true, 1), SaleChannel("cardmarket", "Cardmarket", 5.0, true, 0))

    // s1 aktiv (c1 gezaehlt, c2 zurueckgenommen), s2 storniert (c3), s3/s4 verkaufen beide c4 (sold_in -> s3).
    private val data = SalesData(
        sales = listOf(head("s4", "2026-09-21"), head("s3", "2026-09-20"), head("s2", "2026-09-10", status = "storniert"), head("s1", "2026-08-01")),
        notes = mapOf("s1" to "Notiz"),
        items = listOf(
            item("s1", "c1", 3.0, 8.0), item("s1", "c2", 1.0, 0.0, deleted = true),
            item("s2", "c3", 2.0, 5.0, card = "2"),
            item("s3", "c4", 4.0, 10.0), item("s4", "c4", 4.0, 9.0),
        ),
        soldIn = mapOf("c1" to "s1", "c4" to "s3"),
        channels = channels,
    )

    @Test fun `Liste -- Kartenzahl gezaehlt bei aktiven, lebend bei stornierten, Doppelverkauf markiert`() {
        val o = SalesOverview.overview(data, "gesamt", "2026-09-21")
        val rows = o.rows.associateBy { it.sale.saleId }
        assertEquals(listOf("s4", "s3", "s2", "s1"), o.rows.map { it.sale.saleId })
        assertEquals(1, rows.getValue("s1").cards)
        assertEquals(1, rows.getValue("s2").cards) // storniert: lebende Position trotz sold_in = null
        assertEquals(500L, rows.getValue("s2").netCents)
        assertEquals(1, rows.getValue("s3").cards)
        assertEquals(0, rows.getValue("s4").cards) // c4 zeigt auf s3
        assertEquals(0L, rows.getValue("s4").netCents)
        assertTrue(rows.getValue("s3").doubleSold && rows.getValue("s4").doubleSold)
        assertFalse(rows.getValue("s1").doubleSold)
        assertEquals(SalesMath.totals(data.sales, data.lines(), data::soldInOf), o.totals)
        assertEquals(12, o.byMonth.size)
    }

    @Test fun `Liste und Detail -- aktiver Verkauf ohne verkauftes Exemplar markiert (I3)`() {
        val o = SalesOverview.overview(data, "gesamt", "2026-09-21").rows.associateBy { it.sale.saleId }
        assertFalse(o.values.any { it.orphaned }) // s4 ist Doppelverkauf (c4 -> aktiver s3), s2 storniert
        val lost = data.copy(soldIn = mapOf("c4" to "s3")) // c1 zeigt nicht mehr auf s1
        assertTrue(SalesOverview.overview(lost, "gesamt", "2026-09-21").rows.single { it.sale.saleId == "s1" }.orphaned)
        assertTrue(SalesOverview.isOrphaned(lost, "s1"))
        assertFalse(SalesOverview.isOrphaned(data, "s1"))
    }

    @Test fun `Zeitraum filtert Liste und Kennzahlen, Monatsbalken bleiben ueber alle`() {
        val o = SalesOverview.overview(data, "monat", "2026-09-21")
        assertEquals(listOf("s4", "s3", "s2"), o.rows.map { it.sale.saleId })
        assertEquals(1000L, o.totals.netCents)
        assertEquals(800L, o.byMonth.first { it.month == "2026-08" }.netCents)
    }

    @Test fun `Verkauft in der Kartenansicht -- lebende Positionen der Karte in Listenreihenfolge`() {
        val rows = SalesOverview.cardSold(data, "1")
        assertEquals(listOf("s4", "s3", "s1"), rows.map { it.sale.saleId })
        assertEquals(listOf("c4", "c4", "c1"), rows.map { it.item.copyId })
        assertEquals("storniert", SalesOverview.cardSold(data, "2").single().sale.status)
        assertTrue(SalesOverview.cardSold(data, "999").isEmpty())
        // Position ohne Kopf (Verkauf geloescht/fehlt) faellt weg.
        assertTrue(SalesOverview.cardSold(data.copy(sales = emptyList()), "1").isEmpty())
    }

    @Test fun `Detail -- lebende zuerst, Marktwert und Rest ohne Rueckgaben`() {
        val items = SalesOverview.detailItems(data, "s1")
        assertEquals(listOf("c1", "c2"), items.map { it.copyId })
        assertEquals(300L, SalesOverview.marketCents(items))
        assertEquals(0L, SalesOverview.marketCents(items, setOf("c1")))
        assertEquals(listOf("c1" to 300L), SalesOverview.remaining(items, emptySet()))
        assertTrue(SalesOverview.remaining(items, setOf("c1")).isEmpty())
        assertTrue(SalesOverview.isDoubleSold(data, "s4"))
    }

    @Test fun `Bearbeiten -- eigener ausgeblendeter Kanal waehlbar, unveraenderter Kanal behaelt die Momentaufnahme`() {
        val hidden = head("s9", "2026-09-01", channel = "alt", name = "Flohmarkt")
        val opts = SalesOverview.editChannels(channels, hidden)
        assertEquals(listOf("alt", "ebay", "cardmarket"), opts.map { it.channelId })
        assertEquals(channels, SalesOverview.editChannels(channels, head("s1", "2026-08-01")))
        assertEquals("Flohmarkt", SalesOverview.channelNameFor(hidden, "alt", channels))
        val renamed = head("s1", "2026-08-01", name = "eBay (alt)")
        assertEquals("eBay (alt)", SalesOverview.channelNameFor(renamed, "ebay", channels))
        assertEquals("Cardmarket", SalesOverview.channelNameFor(renamed, "cardmarket", channels))
        assertNull(SalesOverview.channelNameFor(renamed, "weg", channels))
    }

    @Test fun `Datum TT-MM-JJJJ`() {
        assertEquals("21.09.2026", SalesOverview.dateText("2026-09-21"))
    }
}
