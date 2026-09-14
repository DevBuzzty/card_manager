package com.example.yugiohscanner

import com.example.yugiohscanner.ml.PriceRef
import com.example.yugiohscanner.ml.PriceSteps
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/priceSteps.test.js -- dieselbe Fixture docs/fixtures/portfolio/price-steps.json. */
class PriceStepsTest {
    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/price-steps.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val rowsJson = c.getJSONArray("rows")
            val rows = (0 until rowsJson.length()).map { j ->
                val o = rowsJson.getJSONObject(j)
                PriceRef("1", "X", "DE", "Common", o.getString("day"), o.getDouble("price"), o.getString("source"))
            }
            val s = PriceSteps.compute(rows, c.getString("today"), c.getInt("window"))
            val e = c.getJSONObject("expected")
            assertEquals(name, e.getString("kind"), s.kind)
            if (e.has("flatDay")) {
                assertEquals(name, e.getString("flatDay"), s.flatDay)
                assertEquals(name, e.getDouble("flatPrice"), s.flatPrice!!, 1e-9)
            }
            val ep = e.getJSONArray("points")
            assertEquals("$name points", ep.length(), s.points.size)
            s.points.forEachIndexed { j, p ->
                assertEquals("$name points[$j]", ep.getJSONObject(j).getString("day"), p.day)
                assertEquals("$name points[$j]", ep.getJSONObject(j).getDouble("price"), p.price, 1e-9)
            }
            val em = e.getJSONArray("markers")
            assertEquals("$name markers", em.length(), s.markers.size)
            s.markers.forEachIndexed { j, m ->
                assertEquals("$name markers[$j]", em.getJSONObject(j).getString("day"), m.day)
                assertEquals("$name markers[$j]", em.getJSONObject(j).getString("family"), m.family)
            }
        }
    }
}
