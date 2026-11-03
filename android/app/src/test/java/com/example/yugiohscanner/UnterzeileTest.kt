package com.example.yugiohscanner

import com.example.yugiohscanner.ui.ScanErgebnis
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

/** Fixture docs/fixtures/unterzeile.json (Spec 2026-11-03 §2.3). */
class UnterzeileTest {
    @Test
    fun `alle Faelle der Fixture`() {
        val f = JSONObject(Fixtures.text("docs/fixtures/unterzeile.json"))
        val heute = LocalDate.parse(f.getString("heute"))
        val cases = f.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            fun s(k: String) = if (!c.has(k) || c.isNull(k)) null else c.getString(k)
            val z = ScanErgebnis.unterzeile(
                kopf = KopfPreisTest.preis(c.getJSONObject("kopf")),
                sicher = c.optBoolean("sicher", false),
                abgeleitet = c.optBoolean("abgeleitet", false),
                low = if (!c.has("low") || c.isNull("low")) null else c.getDouble("low"),
                standDatum = s("standDatum"),
                heute = heute,
                sucht = c.optBoolean("sucht", false),
                nachladen = c.optBoolean("nachladen", false),
                preiseFehlen = c.optBoolean("preiseFehlen", false),
                letzterFehler = s("letzterFehler"),
                liveFehler = c.optBoolean("liveFehler", false),
            )
            assertEquals(c.getString("name"), c.getString("expect"), z)
        }
    }
}
