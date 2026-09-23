package com.example.yugiohscanner

import com.example.yugiohscanner.ml.CardFilterPresets
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/cardFilters.test.js -- dieselbe Fixture docs/fixtures/design/filter-presets.json. */
class CardFilterPresetsTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/design/filter-presets.json"))

    @Test fun voreinstellungenHeissenGleich() {
        val a = f.getJSONArray("presets")
        assertEquals((0 until a.length()).map { a.getJSONArray(it).getString(0) to a.getJSONArray(it).getString(1) },
            CardFilterPresets.ALLE)
    }

    @Test fun alleFaelleTreffen() {
        val a = f.getJSONArray("faelle")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            val k = c.getJSONObject("karte")
            val name = c.getString("name")
            assertEquals("$name: unvollstaendig", c.getBoolean("unvollstaendig"),
                CardFilterPresets.trifft(k.optString("set_code"), k.optString("rarity"), k.optDouble("price", 0.0), "unvollstaendig"))
            assertEquals("$name: foils", c.getBoolean("foils"),
                CardFilterPresets.trifft(k.optString("set_code"), k.optString("rarity"), k.optDouble("price", 0.0), "foils"))
        }
    }

    // Fixrunde 1 (siehe cardFilters.test.js): eine Kachel buendelt mehrere Drucke -- sie muss
    // treffen, wenn IRGENDEIN Druck trifft, nicht nur der erste.
    @Test fun alleGruppenTreffen() {
        val a = f.getJSONArray("gruppen")
        for (i in 0 until a.length()) {
            val g = a.getJSONObject(i)
            val name = g.getString("name")
            val druckeJson = g.getJSONArray("drucke")
            val drucke = (0 until druckeJson.length()).map {
                val d = druckeJson.getJSONObject(it)
                CardFilterPresets.Druck(d.optString("set_code"), d.optString("rarity"), d.optDouble("price", 0.0))
            }
            assertEquals("$name: unvollstaendig", g.getBoolean("unvollstaendig"),
                CardFilterPresets.trifftGruppe(drucke, "unvollstaendig"))
            assertEquals("$name: foils", g.getBoolean("foils"),
                CardFilterPresets.trifftGruppe(drucke, "foils"))
        }
    }
}
