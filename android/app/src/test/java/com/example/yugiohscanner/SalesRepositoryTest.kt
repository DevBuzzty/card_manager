package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SaleHeadInput
import com.example.yugiohscanner.cloud.SaleItemRow
import com.example.yugiohscanner.cloud.SalesRepository
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.SalesMath
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SalesRepositoryTest {
    @Test fun `Buchungs-Nutzlast fuer book_sale`() {
        val body = SalesRepository.bookBody("s1", SaleHeadInput("2026-09-21", "ebay", "eBay", 10.0, null, 1.6, " "),
            listOf("c1" to 300L, "c2" to 100L), listOf(630L, 210L))
        val sale = body.getJSONObject("p_sale")
        assertEquals("s1", sale.getString("sale_id"))
        assertTrue(sale.isNull("fees"))
        assertEquals(1.6, sale.getDouble("shipping"), 0.0)
        assertTrue("leere Notiz wird null", sale.isNull("note"))
        val items = body.getJSONArray("p_items")
        assertEquals(3.0, items.getJSONObject(0).getDouble("value_at_sale"), 0.0)
        assertEquals(6.3, items.getJSONObject(0).getDouble("share"), 0.0)
    }
    @Test fun `Verkaeufe und Positionen lesen`() {
        val s = SalesRepository.parseSales("""[{"sale_id":"s1","sold_on":"2026-09-21","channel_id":"ebay","channel_name":"eBay","gross":10,"fees":null,"shipping":"1.60","status":"aktiv","note":null,"deleted":false}]""")
        assertEquals(1.6, s.first().head.shipping!!, 0.0)
        val i = SalesRepository.parseItems("""[{"sale_id":"s1","copy_id":"c1","value_at_sale":3,"share":8.4,"was_for_sale":true,"card_id":"1","set_code":"X","language":"DE","rarity":"Common","edition":"unknown","condition":"NM","name":null,"image_url":null,"deleted":false}]""")
        assertTrue(i.first().wasForSale)
        assertEquals(null, i.first().name)
    }
    @Test fun `book_sale Positionen stehen nach copyId sortiert in der Nutzlast`() {
        // Absichtlich unsortiert uebergeben (Controller-Vorgabe 1): bookBody selbst sortiert nicht --
        // book() muss VOR dem Aufruf sortieren. Dieser Test haelt die erwartete, sortierte Reihenfolge fest.
        val body = SalesRepository.bookBody("s1", SaleHeadInput("2026-09-21", "ebay", "eBay", 10.0, null, null, null),
            listOf("c1" to 300L, "c2" to 100L).sortedBy { it.first }, listOf(300L, 100L))
        val items = body.getJSONArray("p_items")
        assertEquals("c1", items.getJSONObject(0).getString("copy_id"))
        assertEquals("c2", items.getJSONObject(1).getString("copy_id"))
    }
    @Test fun `update_sale Nutzlast enthaelt Anteile fuer jede verbleibende Position`() {
        val body = SalesRepository.updateBody("s1", SaleHeadInput("2026-09-21", "ebay", "eBay", 10.0, null, null, null),
            listOf("c1" to 700L, "c2" to 300L), listOf("c3"))
        val shares = body.getJSONArray("p_shares")
        assertEquals(2, shares.length())
        val ids = (0 until shares.length()).map { shares.getJSONObject(it).getString("copy_id") }
        assertEquals(listOf("c1", "c2"), ids)
        assertEquals(7.0, shares.getJSONObject(0).getDouble("share"), 0.0)
        assertEquals(3.0, shares.getJSONObject(1).getDouble("share"), 0.0)
        val returned = body.getJSONArray("p_returned")
        assertEquals(1, returned.length())
        assertEquals("c3", returned.getString(0))
    }

    // Fix-Runde 1, Befund 2: prepareItems ist die von book() UND update() geteilte Sortier-/Verteilstelle
    // (Controller-Vorgabe 1). Bewusst UNSORTIERT uebergeben -- ein Sabotage-Test (sortedBy entfernt) hat
    // bestaetigt, dass genau dieser Test ohne die Sortierung scheitert (siehe Fix-Bericht).
    @Test fun `prepareItems sortiert unsortierte Positionen nach copyId vor der Verteilung`() {
        val head = SaleHeadInput("2026-09-21", "ebay", "eBay", 10.0, null, null, null)
        val (sorted, shares) = SalesRepository.prepareItems(head, listOf("c2" to 400L, "c1" to 600L))
        assertEquals(listOf("c1", "c2"), sorted.map { it.first })
        assertEquals(SalesMath.distribute(SalesMath.netCents(10.0, null, null), listOf(600L, 400L)), shares)
    }

    // Fix-Runde 1, Befund 1: Supabase deckelt `limit` bei 1000 -- sales/sale_items/card_copies muessen
    // blaettern. Die Query-Bauer sind rein, wie StoreQueries/StoreQueriesTest.
    @Test fun `Verkaeufe-Seite ohne Filter, Folgeseite nach sale_id`() {
        assertEquals(
            listOf(
                "select" to "sale_id,sold_on,channel_id,channel_name,gross,fees,shipping,status,note,deleted",
                "deleted" to "eq.false", "order" to "sale_id.asc", "limit" to "1000",
            ),
            SalesRepository.salesPageParams(null),
        )
        assertEquals("or" to "(sale_id.gt.\"s1\")", SalesRepository.salesPageParams("s1").last())
    }
    @Test fun `Positionen-Seite blaettert nach zusammengesetztem Schluessel sale_id,copy_id`() {
        val after = SaleItemRow("s1", "c7", 0.0, 0.0, false, "1", "X", "DE", "Common", "unknown", "NM", null, null, false)
        assertEquals("select" to "*", SalesRepository.itemsPageParams(null).first())
        assertEquals(
            "or" to "(sale_id.gt.\"s1\",and(sale_id.eq.\"s1\",copy_id.gt.\"c7\"))",
            SalesRepository.itemsPageParams(after).last(),
        )
    }
    @Test fun `sold_in-Seite blaettert nach copy_id`() {
        assertEquals("sold_in" to "not.is.null", SalesRepository.soldInPageParams(null)[1])
        assertEquals("or" to "(copy_id.gt.\"c9\")", SalesRepository.soldInPageParams("c9").last())
    }
    @Test fun `KeysetPager blaettert Verkaufsseiten -- volle Seite fordert eine weitere Anfrage an, kurze Seite beendet`() = runBlocking {
        val allIds = (1..2500).map { "s%05d".format(it) }
        var calls = 0
        val fetch: suspend (String?) -> List<String> = { after ->
            calls++
            val from = if (after == null) 0 else allIds.indexOf(after) + 1
            allIds.subList(from, minOf(from + 1000, allIds.size))
        }
        val got = KeysetPager.all(1000, fetch)
        assertEquals(2500, got.size)
        assertEquals(3, calls) // 1000 + 1000 + 500 (kurz, beendet ohne weitere Anfrage)
    }

    // Fix-Runde 1, Befund 3: leerer Fehlerrumpf darf keine leere Meldung ergeben.
    @Test fun `dbErrorMessage nutzt die DB-Nachricht, sonst Rohtext, sonst einen Standardtext bei leerem Rumpf`() {
        assertEquals(
            "Verkauf bereits gebucht.",
            SalesRepository.dbErrorMessage("""{"message":"Verkauf bereits gebucht.","code":"P0001"}""", 400),
        )
        assertEquals("kaputtes json", SalesRepository.dbErrorMessage("kaputtes json", 400))
        assertEquals("Cloud-Aufruf fehlgeschlagen (500)", SalesRepository.dbErrorMessage(null, 500))
        assertEquals("Cloud-Aufruf fehlgeschlagen (500)", SalesRepository.dbErrorMessage("", 500))
        assertEquals("Cloud-Aufruf fehlgeschlagen (500)", SalesRepository.dbErrorMessage("   ", 500))
    }

    // Fix-Runde 1, Befund 4: NaN schluepft an `< 0 || > 100` vorbei (IEEE754-Vergleiche mit NaN sind immer false).
    @Test fun `saveChannel lehnt NaN-Gebuehr ab`() = runBlocking {
        try {
            SalesRepository.saveChannel(null, "Testkanal", Double.NaN)
            fail("erwartete IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertEquals("Die Gebühr muss zwischen 0 und 100 % liegen.", e.message)
        }
    }
}
