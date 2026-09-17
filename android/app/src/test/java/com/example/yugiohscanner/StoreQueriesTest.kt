package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreQueries
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Die Abfrageparameter des Speichers -- am Server wird nicht getestet, also hier Zeichen fuer Zeichen. */
class StoreQueriesTest {

    private fun copy(id: String, updatedAt: String) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = false, containerId = null, page = null,
        slot = null, tags = null, note = null, updatedAt = updatedAt,
    )

    @Test fun `Exemplare vollstaendig, erste Seite`() {
        assertEquals(
            listOf(
                "select" to StoreQueries.COPY_COLS,
                "deleted" to "eq.false",
                "order" to "copy_id.asc",
                "limit" to "1000",
            ),
            StoreQueries.copies(null, null),
        )
    }

    @Test fun `Exemplare vollstaendig, Folgeseite nach Schluessel`() {
        val p = StoreQueries.copies(null, copy("u7", "2026-09-13T12:00:00+00:00"))
        assertEquals("or" to "(copy_id.gt.\"u7\")", p.last())
    }

    @Test fun `Exemplare Delta enthaelt geloeschte und blaettert nach Zeitstempel und Schluessel`() {
        val p = StoreQueries.copies("2026-09-13T11:59:00Z", copy("u7", "2026-09-13T12:00:00.5+00:00"))
        assertEquals(
            listOf(
                "select" to StoreQueries.COPY_COLS,
                "updated_at" to "gte.2026-09-13T11:59:00Z",
                "order" to "updated_at.asc,copy_id.asc",
                "limit" to "1000",
                "or" to "(updated_at.gt.\"2026-09-13T12:00:00.500Z\",and(updated_at.eq.\"2026-09-13T12:00:00.500Z\",copy_id.gt.\"u7\"))",
            ),
            p,
        )
        assertFalse("kein deleted-Filter im Delta", p.any { it.first == "deleted" })
        assertFalse("kein Plus in der URL", p.any { it.second.contains('+') })
    }

    @Test fun `Karten vollstaendig filtern lebende mit Menge und sortieren nach Schluessel`() {
        val after = CardRow(id = "1", setCode = "LOB-DE001", language = "DE", name = null, imageUrl = null,
            rarity = "Secret Rare", quantity = 1, price = null)
        val p = StoreQueries.cards(null, after)
        assertEquals("select" to "*", p[0])
        assertEquals("deleted" to "eq.false", p[1])
        assertEquals("quantity" to "gt.0", p[2])
        assertEquals("order" to "id.asc,set_code.asc,language.asc,rarity.asc", p[3])
        assertEquals("or", p.last().first)
    }

    @Test fun `Karte mit leerer Seltenheit blaettert nach leerer Zeichenkette, nicht nach Unknown`() {
        val after = CardRow(id = "1", setCode = "LOB-DE001", language = "DE", name = null, imageUrl = null,
            rarity = null, quantity = 1, price = null, updatedAt = "2026-09-13T12:00:00+00:00")
        for (p in listOf(StoreQueries.cards(null, after), StoreQueries.cards("2026-09-13T11:59:00Z", after))) {
            val or = p.last().second
            assertTrue(or, or.contains("rarity.gt.\"\""))
            assertFalse(or, or.contains("Unknown"))
        }
    }

    @Test fun `Karten Delta ohne Mengen- und Loeschfilter`() {
        val p = StoreQueries.cards("2026-09-13T11:59:00Z", null)
        assertEquals(
            listOf(
                "select" to "*",
                "updated_at" to "gte.2026-09-13T11:59:00Z",
                "order" to "updated_at.asc,id.asc,set_code.asc,language.asc,rarity.asc",
                "limit" to "1000",
            ),
            p,
        )
    }

    @Test fun `Behaelter vollstaendig und Delta`() {
        assertEquals(
            listOf("select" to StoreQueries.CONTAINER_COLS, "deleted" to "eq.false", "order" to "container_id.asc", "limit" to "1000"),
            StoreQueries.containers(null, null),
        )
        assertEquals(
            "order" to "updated_at.asc,container_id.asc",
            StoreQueries.containers("1970-01-01T00:00:00Z", null)[2],
        )
    }

    @Test fun `Spaltenlisten enthalten updated_at`() {
        assertEquals(
            "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,for_sale,created_at,updated_at",
            StoreQueries.COPY_COLS,
        )
        assertEquals("container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at", StoreQueries.CONTAINER_COLS)
    }
}
