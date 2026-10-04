package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DruckPreis
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Fixture docs/fixtures/druck-preis.json (Spec 2026-10-04 §3.3). */
class DruckPreisTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/druck-preis.json"))

    @Test
    fun `alle Faelle der Fixture`() {
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val eigen = if (c.isNull("eigenerPreis")) null else c.getDouble("eigenerPreis")
            val cm = c.getJSONArray("cm").let { a -> (0 until a.length()).map { a.getInt(it) } }
            val t = c.getJSONObject("trends")
            val p = DruckPreis.fuer(eigen, cm) { id -> if (t.has(id.toString())) t.getDouble(id.toString()) else null }
            when (c.getString("art")) {
                "fest" -> assertEquals(name, c.getDouble("eur"), (p as DruckPreis.Fest).eur, 0.001)
                "spanne" -> {
                    p as DruckPreis.Spanne
                    assertEquals(name, c.getDouble("min"), p.min, 0.001)
                    assertEquals(name, c.getDouble("max"), p.max, 0.001)
                }
                else -> assertEquals(name, DruckPreis.Keiner, p)
            }
            assertEquals(name, c.getString("text"), DruckPreis.text(p))
        }
    }

    @Test
    fun `spanneUeber fasst Fest und Spanne zusammen, Keiner zaehlt nicht`() {
        val p = DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, false), DruckPreis.Spanne(2.0, 9.0), DruckPreis.Keiner))
        assertEquals(DruckPreis.Spanne(2.0, 9.0), p)
        assertEquals(DruckPreis.Keiner, DruckPreis.spanneUeber(listOf(DruckPreis.Keiner)))
        assertEquals(DruckPreis.Fest(5.0, false), DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, false))))
    }
}
