package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Spec G4 §6 -- ZWILLING von desktop/electron/valuation.test.cjs und desktop/src/utils/valuation.test.mjs (Fixture docs/fixtures/valuation/first-ed.json). */
class ValuationTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/valuation/first-ed.json"))

    private fun copy(cond: String, ed: String = "unknown", id: String = "id-$cond-$ed-${System.nanoTime()}") =
        CopyRow(id, "1", "LOB-DE001", "DE", "Ultra Rare", ed, cond, false,
            containerId = null, page = null, slot = null, tags = null, note = null)

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    private fun card(o: JSONObject) = CardRow("1", "LOB-DE001", "DE", "Test", null, "Ultra Rare", 1, dbl(o, "price"),
        priceFirstEd = dbl(o, "price_first_ed"), cmFirstEdFactor = dbl(o, "cm_first_ed_factor"))

    private fun plain(price: Double?) = CardRow("1", "LOB-DE001", "DE", "Test", null, "Ultra Rare", 1, price)

    @Test
    fun factorsMatchTheSharedJsonFile() {
        // Gradle runs unit tests with the module dir (android/app) as working directory.
        val f = File("../../desktop/electron/condition-factors.json")
        assertTrue("shared factor file must exist at ${f.absolutePath}", f.exists())
        val json = JSONObject(f.readText())
        for (c in Valuation.CONDITIONS) assertEquals("factor $c", json.getDouble(c), Valuation.factor(c), 1e-9)
        assertEquals(json.length(), Valuation.CONDITIONS.size)
    }

    @Test
    fun valueOfSumsUnitPriceTimesFactor() {
        assertEquals(17.0, Valuation.valueOf(plain(10.0), listOf(copy("NM"), copy("GD"))), 1e-9)
        assertEquals(0.0, Valuation.valueOf(plain(null), listOf(copy("NM"))), 1e-9)
        assertEquals(1.0, Valuation.factor(""), 1e-9)
        assertEquals(1.0, Valuation.factor("XX"), 1e-9)
        assertEquals("geloeschte Exemplare zaehlen nicht", 10.0,
            Valuation.valueOf(plain(10.0), listOf(copy("NM"), copy("NM").copy(deleted = true))), 1e-9)
    }

    @Test
    fun `Fixture unitPrice`() {
        val cases = fix.getJSONArray("unitPrice")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val cp = c.getJSONObject("copy")
            assertEquals(c.getString("name"), c.getDouble("unit"),
                Valuation.unitPrice(card(c.getJSONObject("card")), copy(cp.getString("condition"), cp.getString("edition"))), 1e-9)
        }
    }

    @Test
    fun `Fixture valueOf`() {
        val cases = fix.getJSONArray("valueOf")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val arr = c.getJSONArray("copies")
            val copies = (0 until arr.length()).flatMap { j ->
                val o = arr.getJSONObject(j)
                (0 until o.optInt("count", 1)).map { k -> copy(o.getString("condition"), o.getString("edition"), "c$j-$k") }
            }
            assertEquals(c.getString("name"), c.getDouble("value"), Valuation.valueOf(card(c.getJSONObject("card")), copies), 1e-9)
        }
    }

    @Test
    fun `Fixture Preiszeile`() {
        val cases = fix.getJSONArray("line")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = if (c.isNull("line")) null else c.getString("line")
            assertEquals(c.getString("name"), expected, Valuation.firstEdLine(card(c.getJSONObject("card"))))
        }
    }

    @Test
    fun groupOrdersByEditionThenCondition() {
        val g = Valuation.group(listOf(copy("NM"), copy("GD", "first"), copy("NM")))
        assertEquals(listOf(Valuation.Group("first", "GD", 1), Valuation.Group("unknown", "NM", 2)), g)
    }
}
