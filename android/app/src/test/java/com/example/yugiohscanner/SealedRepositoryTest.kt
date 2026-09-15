package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogSealedProduct
import com.example.yugiohscanner.cloud.SealedAddPlan
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SnapshotsRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SealedRepositoryTest {
    private val display = CatalogSealedProduct(254469L, "Metal Raiders Booster Box", "display", 499.29)
    private val noTrend = CatalogSealedProduct(254468L, "Legend of Blue Eyes White Dragon Booster Box", "display", null)

    private fun item(id: String, product: Long, quantity: Int, createdAt: String?, deleted: Boolean = false) =
        SealedItem(id, product, "x", "display", quantity, null, null, createdAt, deleted)

    @Test fun `lebende Zeilen in stabiler Ordnung, Schreibziel nur lebend`() {
        assertEquals(
            listOf(
                "select" to "sealed_id,cm_product_id,name,kind,quantity,price,price_updated_at,created_at,deleted",
                "deleted" to "eq.false", "order" to "created_at.asc,sealed_id.asc", "limit" to "1000",
            ),
            SealedRepository.listParams(),
        )
        assertEquals(listOf("sealed_id" to "eq.s1", "deleted" to "eq.false"), SealedRepository.liveRowParams("s1"))
    }

    @Test fun `parse mit Nullwerten`() {
        val rows = SealedRepository.parse(
            """[{"sealed_id":"s1","cm_product_id":254469,"name":"Metal Raiders Booster Box","kind":"display","quantity":2,"price":499.29,"price_updated_at":"2026-09-15T05:00:03.123456+00:00","created_at":"2026-09-14T18:00:00+00:00","deleted":false},
               {"sealed_id":"s2","cm_product_id":254468,"name":"Legend of Blue Eyes White Dragon Booster Box","kind":"display","quantity":1,"price":null,"price_updated_at":null,"created_at":null,"deleted":false}]""",
        )
        assertEquals(
            listOf(
                SealedItem("s1", 254469L, "Metal Raiders Booster Box", "display", 2, 499.29, "2026-09-15T05:00:03.123456+00:00", "2026-09-14T18:00:00+00:00", false),
                SealedItem("s2", 254468L, "Legend of Blue Eyes White Dragon Booster Box", "display", 1, null, null, null, false),
            ),
            rows,
        )
    }

    @Test fun `Anlegen - lebende Zeile desselben Produkts waechst, die aelteste zuerst`() {
        val live = listOf(
            item("s-neu", 254469L, 1, "2026-09-15T10:00:00+00:00"),
            item("s-alt", 254469L, 2, "2026-09-01T10:00:00+00:00"),
            item("s-anders", 230006L, 5, "2026-08-01T10:00:00+00:00"),
        )
        assertEquals(SealedAddPlan.Increase("s-alt", 5), SealedRepository.planAdd(live, display, 3))
    }

    @Test fun `Anlegen - geloeschte und fremde Zeilen zaehlen nicht`() {
        val live = listOf(
            item("s-weg", 254469L, 2, "2026-09-01T10:00:00+00:00", deleted = true),
            item("s-anders", 230006L, 5, null),
        )
        assertEquals(SealedAddPlan.Insert(display, 1), SealedRepository.planAdd(live, display, 1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `Anlegen mit Menge 0 wirft`() {
        SealedRepository.planAdd(emptyList(), display, 0)
    }

    @Test fun `neue Zeile traegt Name, Art und Startpreis aus der Produktliste`() {
        val body = SealedRepository.insertBody("u-1", display, 2, "2026-09-15T12:00:00Z")
        assertEquals("u-1", body.getString("sealed_id"))
        assertEquals(254469L, body.getLong("cm_product_id"))
        assertEquals("Metal Raiders Booster Box", body.getString("name"))
        assertEquals("display", body.getString("kind"))
        assertEquals(2, body.getInt("quantity"))
        assertEquals(499.29, body.getDouble("price"), 1e-9)
        assertEquals("2026-09-15T12:00:00Z", body.getString("price_updated_at"))
        assertFalse(body.has("deleted"))
        val none = SealedRepository.insertBody("u-2", noTrend, 1, "2026-09-15T12:00:00Z")
        assertTrue(none.isNull("price"))
        assertTrue(none.isNull("price_updated_at"))
    }

    @Test fun `Tageswert-Body mit sealed_value`() {
        val b = SnapshotsRepository.upsertBody(1008.5, 12, 998.5)
        assertEquals(1008.5, b.getDouble("total_value"), 1e-9)
        assertEquals(12, b.getInt("card_count"))
        assertEquals(998.5, b.getDouble("sealed_value"), 1e-9)
    }
}
