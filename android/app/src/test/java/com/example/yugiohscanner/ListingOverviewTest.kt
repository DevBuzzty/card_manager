package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ListingOverview
import com.example.yugiohscanner.ml.ListingText
import org.junit.Assert.assertEquals
import org.junit.Test

class ListingOverviewTest {
    private fun head(id: String, channel: String, listedOn: String, status: String = "aktiv", price: Long = 1000, deleted: Boolean = false) =
        ListingText.Head(id, channel, if (channel == "cardmarket") "Cardmarket" else "eBay", "Titel $id", price, status, listedOn, deleted = deleted)
    private fun item(listing: String, copy: String, deleted: Boolean = false) =
        ListingText.Item(copy, "1", "Dunkler Magier", "LOB-DE005", "DE", "Ultra Rare", "first", "NM", listingId = listing, deleted = deleted)

    private val heads = listOf(
        head("a", "ebay", "2026-09-20"),
        head("b", "cardmarket", "2026-09-22", status = "beendet"),
        head("c", "ebay", "2026-09-21", status = "verkauft"),
        head("x", "ebay", "2026-09-22", deleted = true),
    )
    private val items = listOf(item("a", "c1"), item("a", "c2"), item("a", "c3", deleted = true), item("b", "c4"), item("c", "c5"))

    @Test fun `Zeilen jüngste zuerst, gelöschte fehlen, Kartenzahl nur lebende Positionen`() {
        val rows = ListingOverview.rows(heads, items, { null }, emptyMap(), "2026-09-22")
        assertEquals(listOf("b", "c", "a"), rows.map { it.head.listingId })
        assertEquals(listOf(1, 1, 2), rows.map { it.cards })
        assertEquals(listOf(0, 1, 2), rows.map { it.days })
        assertEquals("1× Dunkler Magier LOB-DE005", rows[0].title)
        assertEquals("Titel a", rows[2].title)
    }

    @Test fun `Marktwert zählt fehlende Exemplare als 0`() {
        val values = mapOf("c1" to 250L)
        val a = ListingOverview.rows(heads, items, { values[it] }, emptyMap(), "2026-09-22").first { it.head.listingId == "a" }
        assertEquals(250L, a.marketCents)
    }

    @Test fun `Filter nach Status und Kanal, Kanalliste in Zeilenreihenfolge`() {
        val rows = ListingOverview.rows(heads, items, { null }, emptyMap(), "2026-09-22")
        assertEquals(listOf("a"), ListingOverview.filter(rows, "aktiv", null).map { it.head.listingId })
        assertEquals(listOf("c", "a"), ListingOverview.filter(rows, ListingOverview.ALL, "ebay").map { it.head.listingId })
        assertEquals(emptyList<String>(), ListingOverview.filter(rows, "aktiv", "cardmarket").map { it.head.listingId })
        assertEquals(listOf("cardmarket" to "Cardmarket", "ebay" to "eBay"), ListingOverview.channels(rows))
    }

    @Test fun `verkaufbar sind lebende Positionen mit lebendem Exemplar, sortiert`() {
        val its = listOf(item("a", "c9"), item("a", "c1"), item("a", "c2"), item("a", "c3", deleted = true), item("b", "c4"))
        assertEquals(listOf("c1", "c9"), ListingOverview.liveCopyIds(its, "a") { it != "c2" })
        assertEquals(emptyList<String>(), ListingOverview.liveCopyIds(its, "a") { false })
    }
}
