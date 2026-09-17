package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Duplicates
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec H1 §5.3/§6/§8 -- das Handy liest for_sale, patcht es idempotent und entfernt markierte Exemplare zuerst. */
class SaleCopiesRepoTest {
    private fun copy(id: String, forSale: Boolean = false, deleted: Boolean = false, setCode: String = "LOB-DE005") = CopyRow(
        copyId = id, cardId = "46986414", setCode = setCode, language = "DE", rarity = "Common",
        edition = "unknown", condition = "NM", deleted = deleted, containerId = null, page = null, slot = null,
        tags = null, note = null, forSale = forSale,
    )

    @Test fun `liest for_sale, fehlend oder null ist false`() {
        val rows = CollectionRepository.parseCopies(JSONArray("""[
            {"copy_id":"a","card_id":"1","for_sale":true},
            {"copy_id":"b","card_id":"1","for_sale":false},
            {"copy_id":"c","card_id":"1","for_sale":null},
            {"copy_id":"d","card_id":"1"}
        ]"""))
        assertEquals(listOf(true, false, false, false), rows.map { it.forSale })
    }

    @Test fun `Minus nimmt markierte Exemplare zuerst, sonst bleibt die Reihenfolge`() {
        // copiesOf liefert neueste zuerst: n3, n2, m1 (m1 ist das aelteste, aber markiert).
        val order = CollectionRepository.removalOrder(listOf(copy("n3"), copy("m2", forSale = true), copy("n2"), copy("m1", forSale = true)))
        assertEquals(listOf("m2", "m1", "n3", "n2"), order.map { it.copyId })
    }

    @Test fun `PATCH-Parameter treffen nur lebende Exemplare mit anderem Wert`() {
        assertEquals(
            listOf("copy_id" to "in.(\"u1\",\"u2\")", "deleted" to "eq.false", "for_sale" to "eq.false"),
            CollectionRepository.forSalePatchParams(listOf("u1", "u2"), true),
        )
        assertEquals("eq.true", CollectionRepository.forSalePatchParams(listOf("u1"), false)[2].second)
    }

    @Test fun `Verkaufs-Exemplare nur lebend und mit lebendem Printing`() {
        val live = CardRow("46986414", "LOB-DE005", "DE", "Dunkler Magier", null, "Common", 2, 2.0)
        val gone = CardRow("46986414", "SDY-DE006", "DE", "Dunkler Magier", null, "Common", 0, 1.0, deleted = true)
        val sale = Duplicates.saleCopies(
            listOf(copy("k1"), copy("weg", deleted = true), copy("ohne-printing", setCode = "XXX-DE001"), copy("printing-weg", setCode = "SDY-DE006")),
            listOf(live, gone),
        )
        assertEquals(listOf("k1"), sale.map { it.copy.copyId })
        assertEquals(live, sale.single().card)
        assertTrue(Duplicates.hasPlace(copy("x").copy(note = "Tausch")))
        assertFalse(Duplicates.hasPlace(copy("x").copy(containerId = "", tags = "[]", note = " ")))
    }
}
