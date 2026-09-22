package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListingItemRow
import com.example.yugiohscanner.cloud.ListingRow
import com.example.yugiohscanner.cloud.ListingsData
import com.example.yugiohscanner.cloud.ListingsRepository
import com.example.yugiohscanner.cloud.NewListing
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.ListingText
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListingsRepositoryTest {
    private fun row(id: String, channel: String, price: Double, status: String = "aktiv") =
        ListingRow(id, channel, if (channel == "cardmarket") "Cardmarket" else "eBay", "T", null, price, status, "2026-09-21", null, null, null, null, false)
    private fun item(listing: String, copy: String) =
        ListingItemRow(listing, copy, "1", "LOB-DE005", "DE", "Ultra Rare", "first", "NM", "Dunkler Magier", null, false)
    private fun li(copy: String, condition: String = "NM") =
        ListingText.Item(copy, "1", "Dunkler Magier", "LOB-DE005", "DE", "Ultra Rare", "first", condition)

    @Test fun `Angebote-Seite nur lebende, nach listing_id, Folgeseite mit or`() {
        val p = ListingsRepository.listingsPageParams(null)
        assertEquals("deleted" to "eq.false", p[1])
        assertEquals("order" to "listing_id.asc", p[2])
        assertEquals("limit" to "1000", p[3])
        assertEquals("or" to "(listing_id.gt.\"l9\")", ListingsRepository.listingsPageParams("l9").last())
    }
    @Test fun `Positionen-Seite blaettert nach listing_id,copy_id`() {
        assertEquals("deleted" to "eq.false", ListingsRepository.itemsPageParams(null)[1])
        assertEquals("or" to "(listing_id.gt.\"l1\",and(listing_id.eq.\"l1\",copy_id.gt.\"c7\"))",
            ListingsRepository.itemsPageParams(item("l1", "c7")).last())
    }
    @Test fun `Blaettern ueber 1000 Zeilen -- zweite Seite nach dem letzten Schluessel`() = runBlocking {
        val all = (1..1234).map { "l%05d".format(it) }
        val seen = ArrayList<List<Pair<String, String>>>()
        val got = KeysetPager.all(1000) { after: String? ->
            val p = ListingsRepository.listingsPageParams(after); seen += p
            val from = if (after == null) 0 else all.indexOf(after) + 1
            all.subList(from, minOf(from + 1000, all.size))
        }
        assertEquals(1234, got.size)
        assertEquals(2, seen.size)
        assertEquals("or" to "(listing_id.gt.\"l01000\")", seen[1].last())
    }
    @Test fun `Lesen -- numeric als Text oder Zahl, Datum, null`() {
        val l = ListingsRepository.parseListings("""[{"listing_id":"l1","channel_id":"ebay","channel_name":"eBay","title":null,"description":null,"price":"12.50","status":"aktiv","listed_on":"2026-09-21","sale_id":null,"external_url":null,"note":null,"created_at":"2026-09-21T10:00:00+00:00","deleted":false}]""")
        assertEquals(1250L, l.first().priceCents)
        assertNull(l.first().title)
        val i = ListingsRepository.parseItems("""[{"listing_id":"l1","copy_id":"c1","card_id":"1","set_code":"X","language":"DE","rarity":"Common","edition":"unknown","condition":"NM","name":null,"image_url":null,"deleted":false}]""")
        assertEquals("c1", i.first().copyId)
    }
    @Test fun `Pruefungen wie am PC`() {
        val ok = NewListing("ebay", "eBay", "2026-09-21", 1200, "T", "D", null, null, listOf(li("c1")))
        val live = setOf("c1", "c2"); val ch = setOf("ebay", "cardmarket")
        assertNull(ListingsRepository.checkNew(ok, live, ch))
        assertEquals("Der Angebotspreis muss über 0 € liegen.", ListingsRepository.checkNew(ok.copy(priceCents = 0), live, ch))
        assertEquals("Ungültiges Datum.", ListingsRepository.checkNew(ok.copy(listedOn = "21.09.2026"), live, ch))
        assertEquals("Der Link muss mit http:// oder https:// beginnen.", ListingsRepository.checkNew(ok.copy(externalUrl = "ftp://x"), live, ch))
        assertEquals("Kanal nicht gefunden.", ListingsRepository.checkNew(ok.copy(channelId = "weg"), live, ch))
        assertEquals("Karte bereits verkauft oder gelöscht.", ListingsRepository.checkNew(ok.copy(items = listOf(li("c9"))), live, ch))
        assertTrue(ListingsRepository.checkNew(ok.copy(channelId = "cardmarket", items = listOf(li("c1"), li("c2", "EX"))), live, ch)!!.startsWith("Ein Cardmarket-Angebot"))
        assertEquals("Mindestens eine Karte auswählen.", ListingsRepository.checkNew(ok.copy(items = emptyList()), live, ch))
    }
    @Test fun `checkEdit -- Preis und Link wie beim Anlegen`() {
        assertEquals("Der Angebotspreis muss über 0 € liegen.", ListingsRepository.checkEdit(0, "https://x"))
        assertEquals("Der Link muss mit http:// oder https:// beginnen.", ListingsRepository.checkEdit(100, "ftp://x"))
        assertEquals("Der Link muss mit http:// oder https:// beginnen.", ListingsRepository.checkEdit(100, "javascript:alert(1)"))
        assertNull(ListingsRepository.checkEdit(1, "https://x"))
    }
    @Test fun `Anlegen -- erst Positionen, dann Koepfe, Cardmarket ohne Titel und Text`() {
        val ops = ListingsRepository.createOps(listOf("L1"), listOf(NewListing("cardmarket", "Cardmarket", "2026-09-21", 1001, "X", "Y", " ", null, listOf(li("c2"), li("c1")))))
        assertEquals(listOf("listing_items", "listings"), ops.map { it.table })
        assertTrue(ops.all { it.method == "POST" })
        val items = JSONArray(ops[0].body)
        assertEquals(listOf("c1", "c2"), (0 until items.length()).map { items.getJSONObject(it).getString("copy_id") })
        assertEquals("L1", items.getJSONObject(0).getString("listing_id"))
        val head = JSONArray(ops[1].body).getJSONObject(0)
        assertTrue(head.isNull("title") && head.isNull("description") && head.isNull("external_url"))
        assertEquals(10.01, head.getDouble("price"), 0.0)
        assertEquals("Cardmarket", head.getString("channel_name"))
    }
    @Test fun `Herausnehmen -- letzte Position beendet das Angebot`() {
        val one = ListingsRepository.removeOps("l1", listOf("c1"), listOf("c1", "c2"))
        assertEquals(1, one.size)
        assertEquals(listOf("listing_id" to "eq.l1", "copy_id" to "in.(\"c1\")", "deleted" to "eq.false"), one[0].params)
        val all = ListingsRepository.removeOps("l1", listOf("c2", "c1"), listOf("c1", "c2"))
        assertEquals(2, all.size)
        assertEquals("""{"status":"beendet"}""", all[1].body)
        assertEquals(listOf("listing_id" to "eq.l1", "status" to "eq.aktiv", "deleted" to "eq.false"), all[1].params)
        assertTrue(ListingsRepository.removeOps("l1", listOf("c9"), listOf("c1")).isEmpty())
    }
    @Test fun `Bearbeiten -- nur aktives Angebot, Antwort muss eine Zeile haben`() {
        val ops = ListingsRepository.updateOps(row("l1", "ebay", 12.0), 950, "Neu", "", "https://x", null, emptyList(), listOf("c1"))
        assertEquals(1, ops.size)
        assertTrue(ops[0].expectRow)
        val b = JSONObject(ops[0].body)
        assertEquals(9.5, b.getDouble("price"), 0.0)
        assertTrue(b.isNull("description") && b.isNull("note"))
    }
    @Test fun `Nach book_sale -- Teilverkauf Cardmarket und Aufraeumen der anderen Angebote`() {
        val data = ListingsData(listOf(row("l1", "cardmarket", 10.0), row("l2", "ebay", 12.0)),
            listOf(item("l1", "c1"), item("l1", "c2"), item("l2", "c1"), item("l2", "c3")))
        val (ops, r) = ListingsRepository.afterBookingOps(data, "s1", listOf("c1"), "l1")
        assertEquals(listOf(
            Triple("listing_items", "in.(\"c1\")", """{"deleted":true}"""),
            Triple("listings", null, JSONObject().put("price", 5.0).toString()),
            Triple("listing_items", "in.(\"c1\")", """{"deleted":true}"""),
        ), ops.map { Triple(it.table, it.params.firstOrNull { p -> p.first == "copy_id" }?.second, it.body) })
        assertEquals(listOf("listing_id" to "eq.l2", "copy_id" to "in.(\"c1\")", "deleted" to "eq.false"), ops[2].params)
        assertEquals(listOf("l2"), r.reminders.map { it.listingId })
        assertEquals(false, r.askAdjust)
    }
    @Test fun `Nach book_sale -- ganz verkauft, ohne Angebot nur Aufraeumen, beendetes Angebot wird uebersprungen`() {
        val data = ListingsData(listOf(row("l1", "ebay", 12.0), row("l2", "ebay", 5.0), row("l3", "ebay", 3.0, "beendet")),
            listOf(item("l1", "c1"), item("l2", "c1"), item("l3", "c1")))
        val (whole, r1) = ListingsRepository.afterBookingOps(data, "s1", listOf("c1"), "l1")
        assertEquals(JSONObject().put("status", "verkauft").put("sale_id", "s1").toString(), whole[0].body)
        assertEquals(listOf("listings", "listing_items", "listings"), whole.map { it.table })
        assertEquals("""{"status":"beendet"}""", whole[2].body)
        assertEquals(listOf("l2"), r1.reminders.map { it.listingId })
        val (plain, r2) = ListingsRepository.afterBookingOps(data, "s2", listOf("c1"), null)
        assertEquals(4, plain.size) // l1 und l2: je Position herausnehmen + beenden
        assertEquals(listOf("l1", "l2"), r2.reminders.map { it.listingId })
        val (_, r3) = ListingsRepository.afterBookingOps(data, "s3", listOf("c1"), "l3")
        assertTrue(r3.listingSkipped)
    }
    @Test fun `in-Liste maskiert Anfuehrungszeichen`() {
        assertEquals("in.(\"a\",\"b\\\"c\")", ListingsRepository.inList(listOf("a", "b\"c")))
    }
}
