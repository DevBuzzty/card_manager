package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DruckPreis
import com.example.yugiohscanner.ui.DruckPreis.Quelle
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Fixture docs/fixtures/druck-preis.json (Spec 2026-11-03 §2.1, §2.4). */
class DruckPreisTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/druck-preis.json"))

    private fun ints(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getInt(it) }

    companion object {
        fun quelle(s: String) = when (s) { "sammlung" -> Quelle.SAMMLUNG; "trend" -> Quelle.TREND; "live" -> Quelle.LIVE; else -> error(s) }
    }

    @Test
    fun `alle Faelle der Fixture`() {
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val eigen = if (c.isNull("eigenerPreis")) null else c.getDouble("eigenerPreis")
            val cm = ints(c.getJSONArray("cm"))
            val liveCm = ints(c.optJSONArray("liveCm"))
            val t = c.getJSONObject("trends")
            val lt = c.optJSONObject("liveTrends") ?: JSONObject()
            val p = DruckPreis.fuer(eigen, cm, liveCm) { id ->
                val k = id.toString()
                if (t.has(k)) t.getDouble(k) else if (lt.has(k)) lt.getDouble(k) else null
            }
            when (c.getString("art")) {
                "fest" -> {
                    p as DruckPreis.Fest
                    assertEquals(name, c.getDouble("eur"), p.eur, 0.001)
                    assertEquals(name, quelle(c.getString("quelle")), p.quelle)
                    assertEquals(name, c.optBoolean("mehrdeutig", false), p.mehrdeutig)
                }
                "spanne" -> {
                    p as DruckPreis.Spanne
                    assertEquals(name, c.getDouble("min"), p.min, 0.001)
                    assertEquals(name, c.getDouble("max"), p.max, 0.001)
                    val q = c.getJSONArray("quellen")
                    assertEquals(name, (0 until q.length()).map { quelle(q.getString(it)) }.toSet(), p.quellen)
                }
                else -> assertEquals(name, DruckPreis.Keiner, p)
            }
            assertEquals(name, c.getString("text"), DruckPreis.text(p))
        }
    }

    @Test
    fun `spanneUeber fasst Fest und Spanne zusammen, Keiner und Richtwert zaehlen nicht`() {
        val p = DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, Quelle.TREND), DruckPreis.Spanne(2.0, 9.0), DruckPreis.Keiner,
            DruckPreis.Richtwert(0.01, ausKatalog = true)))
        assertEquals(DruckPreis.Spanne(2.0, 9.0, setOf(Quelle.TREND)), p)
        assertEquals(DruckPreis.Keiner, DruckPreis.spanneUeber(listOf(DruckPreis.Keiner)))
        assertEquals(DruckPreis.Keiner, DruckPreis.spanneUeber(listOf(DruckPreis.Richtwert(0.09, ausKatalog = true))))
        assertEquals(DruckPreis.Fest(5.0, Quelle.TREND), DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, Quelle.TREND))))
    }

    @Test
    fun `spanneUeber Quellenregel`() {
        val s = DruckPreis.Fest(5.0, Quelle.SAMMLUNG)
        assertEquals(s, DruckPreis.spanneUeber(listOf(s)))
        assertEquals(DruckPreis.Fest(5.0, Quelle.TREND), DruckPreis.spanneUeber(listOf(s, DruckPreis.Fest(5.0, Quelle.TREND))))
        assertEquals(DruckPreis.Spanne(5.0, 7.0, setOf(Quelle.SAMMLUNG, Quelle.TREND)),
            DruckPreis.spanneUeber(listOf(s, DruckPreis.Fest(7.0, Quelle.TREND))))
        assertEquals(DruckPreis.Fest(3.0, Quelle.LIVE), DruckPreis.spanneUeber(listOf(DruckPreis.Spanne(3.0, 3.0, setOf(Quelle.LIVE)))))
        assertEquals(DruckPreis.Fest(4.2, Quelle.TREND, mehrdeutig = true),
            DruckPreis.spanneUeber(listOf(DruckPreis.Fest(4.2, Quelle.TREND, mehrdeutig = true), DruckPreis.Fest(4.2, Quelle.TREND))))
        assertEquals(DruckPreis.Spanne(1.0, 2.0, setOf(Quelle.TREND, Quelle.LIVE)),
            DruckPreis.spanneUeber(listOf(DruckPreis.Fest(1.0, Quelle.TREND), DruckPreis.Fest(2.0, Quelle.LIVE))))
    }

    // Review-Nachtrag 2 (03.11.): ein Wert, aber nicht jeder beteiligte Druck bepreist -> nicht druckgenau ("ca."), wie fuer Stufe 4.
    @Test
    fun `spanneUeber - ein Wert, weitere Drucke ohne Preis, ist mehrdeutig`() {
        assertEquals(DruckPreis.Fest(12.4, Quelle.TREND, mehrdeutig = true),
            DruckPreis.spanneUeber(listOf(DruckPreis.Keiner, DruckPreis.Fest(12.4, Quelle.TREND))))
        assertEquals(DruckPreis.Fest(5.0, Quelle.SAMMLUNG, mehrdeutig = true),
            DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, Quelle.SAMMLUNG), DruckPreis.Keiner)))
        assertEquals("ca. 12,40 €", DruckPreis.text(DruckPreis.spanneUeber(listOf(DruckPreis.Keiner, DruckPreis.Fest(12.4, Quelle.TREND)))))
        // alle bepreist und gleich, oder nur ein Druck: weiter druckgenau
        assertEquals(DruckPreis.Fest(5.0, Quelle.TREND),
            DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, Quelle.TREND), DruckPreis.Fest(5.0, Quelle.TREND))))
        assertEquals(DruckPreis.Fest(5.0, Quelle.TREND), DruckPreis.spanneUeber(listOf(DruckPreis.Fest(5.0, Quelle.TREND))))
    }

    @Test
    fun `text - Richtwert mit ab, mehrdeutig mit ca`() {
        assertEquals("ab 0,09 €", DruckPreis.text(DruckPreis.Richtwert(0.09, ausKatalog = true)))
        assertEquals("ca. 4,20 €", DruckPreis.text(DruckPreis.Fest(4.2, Quelle.TREND, mehrdeutig = true)))
        assertEquals("12,40 €", DruckPreis.text(DruckPreis.Fest(12.4, Quelle.LIVE)))
        assertEquals("–", DruckPreis.text(DruckPreis.Keiner))
    }
}
