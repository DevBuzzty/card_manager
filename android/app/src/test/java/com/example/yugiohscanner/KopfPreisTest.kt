package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DruckPreis
import com.example.yugiohscanner.ui.ScanErgebnis
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Fixture docs/fixtures/kopf-preis.json (Spec 2026-11-03 §2.2). */
class KopfPreisTest {
    companion object {
        /** Preis-Objekt der Fixtures kopf-preis.json / unterzeile.json. */
        fun preis(o: JSONObject): DruckPreis.Preis = when (o.getString("art")) {
            "fest" -> DruckPreis.Fest(o.getDouble("eur"), DruckPreisTest.quelle(o.getString("quelle")), o.optBoolean("mehrdeutig", false))
            "spanne" -> DruckPreis.Spanne(o.getDouble("min"), o.getDouble("max"),
                o.getJSONArray("quellen").let { a -> (0 until a.length()).map { DruckPreisTest.quelle(a.getString(it)) }.toSet() })
            "richtwert" -> DruckPreis.Richtwert(o.getDouble("eur"), o.getBoolean("ausKatalog"))
            "keiner" -> DruckPreis.Keiner
            else -> error(o.toString())
        }
    }

    @Test
    fun `alle Faelle der Fixture`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/kopf-preis.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val da = c.getJSONArray("drucke")
            val drucke = (0 until da.length()).map { j ->
                val d = da.getJSONObject(j)
                val druck = ScanErgebnis.Druck(d.getString("setCode"), d.getString("rarity"), d.getString("lang"),
                    emptyList(), 0, preis(d.getJSONObject("preis")), null)
                assertEquals("$name: key", d.getString("key"), ScanErgebnis.key(druck.setCode, druck.rarity, druck.language))
                druck
            }
            val ka = c.getJSONArray("kandidaten")
            val kandidaten = (0 until ka.length()).map { ka.getString(it) }.toSet()
            val richtwert = c.optJSONObject("richtwert")?.let { DruckPreis.Richtwert(it.getDouble("eur"), it.getBoolean("ausKatalog")) }
            val auswahl = if (c.isNull("auswahl")) null else c.getString("auswahl")
            val sprache = if (c.isNull("sprache")) null else c.optString("sprache")   // fehlt -> null (ScanSprache.fest)
            val kopf = ScanErgebnis.kopfPreis(drucke, auswahl, c.getBoolean("sicher"), c.getBoolean("keinTreffer"), kandidaten, richtwert, sprache)
            val e = c.getJSONObject("expect")
            assertEquals(name, preis(e), kopf)
            assertEquals(name, e.getString("text"), DruckPreis.text(kopf))
        }
    }
}
