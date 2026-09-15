package com.example.yugiohscanner

import com.example.yugiohscanner.ml.AlertText
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/alert-text.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/alert-texts.json. */
class AlertTextTest {
    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/alert-texts.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val e = c.getJSONObject("event")
            fun dbl(k: String): Double? = if (e.isNull(k)) null else e.getDouble(k)
            val text = AlertText.of(
                kind = e.getString("kind"),
                name = if (e.isNull("name")) null else e.getString("name"),
                cardId = e.getString("card_id"),
                setCode = if (e.isNull("set_code")) null else e.getString("set_code"),
                rarity = if (e.isNull("rarity")) null else e.getString("rarity"),
                oldPrice = dbl("old_price"),
                newPrice = e.getDouble("new_price"),
                pct = dbl("pct"),
                days = if (e.isNull("days")) null else e.getInt("days"),
                threshold = dbl("threshold"),
            )
            assertEquals(c.getString("name"), c.getString("text"), text)
        }
    }

    @Test fun `Betraege und Prozent`() {
        assertEquals("0,00 €", AlertText.eur(0.0))
        assertEquals("−3,50 €", AlertText.eur(-3.5))
        assertEquals("+0,0 %", AlertText.signedPct(0.0))
        assertEquals("−12,3 %", AlertText.signedPct(-12.34))
    }
}
