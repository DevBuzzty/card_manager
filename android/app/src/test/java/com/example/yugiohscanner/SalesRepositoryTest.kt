package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SaleHeadInput
import com.example.yugiohscanner.cloud.SalesRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
}
