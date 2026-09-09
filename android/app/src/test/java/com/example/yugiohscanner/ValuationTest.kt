package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ValuationTest {
    private fun copy(cond: String, ed: String = "unknown") =
        CopyRow("id-$cond-$ed-${System.nanoTime()}", "1", "LOB-DE001", "DE", "Ultra Rare", ed, cond, false,
            containerId = null, page = null, slot = null, tags = null, note = null)

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
    fun valueOfSumsPriceTimesFactor() {
        assertEquals(17.0, Valuation.valueOf(10.0, listOf(copy("NM"), copy("GD"))), 1e-9)
        assertEquals(0.0, Valuation.valueOf(null, listOf(copy("NM"))), 1e-9)
        assertEquals(1.0, Valuation.factor(""), 1e-9)
        assertEquals(1.0, Valuation.factor("XX"), 1e-9)
    }

    @Test
    fun groupOrdersByEditionThenCondition() {
        val g = Valuation.group(listOf(copy("NM"), copy("GD", "first"), copy("NM")))
        assertEquals(listOf(Valuation.Group("first", "GD", 1), Valuation.Group("unknown", "NM", 2)), g)
    }
}
