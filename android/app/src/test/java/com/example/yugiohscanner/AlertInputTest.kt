package com.example.yugiohscanner

import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ml.AlertParse
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/alertInput.test.js -- dieselbe Fixture docs/fixtures/portfolio/alert-input.json. */
class AlertInputTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/portfolio/alert-input.json"))

    private fun check(cases: JSONArray, fn: (String) -> AlertParse) {
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val input = c.getString("in")
            val expected = AlertParse(
                if (c.isNull("value")) null else c.getDouble("value"),
                if (c.isNull("error")) null else c.getString("error"),
            )
            assertEquals("\"$input\"", expected, fn(input))
        }
    }

    @Test fun `Zielpreis`() = check(fix.getJSONArray("target")) { AlertInput.parseTarget(it) }
    @Test fun `Prozent`() = check(fix.getJSONArray("pct")) { AlertInput.parsePct(it) }
    @Test fun `Mindestbetrag`() = check(fix.getJSONArray("minEur")) { AlertInput.parseMinEur(it) }

    @Test fun `Anzeige im Feld`() {
        val cases = fix.getJSONArray("toInput")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.getString("out"), AlertInput.toInput(if (c.isNull("in")) null else c.getDouble("in")))
        }
    }
}
