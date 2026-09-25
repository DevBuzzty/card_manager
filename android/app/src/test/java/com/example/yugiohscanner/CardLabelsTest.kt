package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.CardLabels
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/cardLabels.test.js -- dieselbe Fixture docs/fixtures/valuation/card-labels.json. */
class CardLabelsTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/valuation/card-labels.json"))
    private fun JSONObject.toMap() = keys().asSequence().associateWith { getString(it) }

    @Test fun `Kartenart-Gruppen`() {
        for (c in f.getJSONArray("typeGroups").objects()) {
            val t = if (c.isNull("type")) null else c.getString("type")
            assertEquals(t.toString(), c.getString("group"), CardLabels.typeGroup(t))
        }
    }

    @Test fun `Attribute und Monstertypen deutsch, Unbekanntes bleibt`() {
        assertEquals(f.getJSONObject("attributes").toMap(), CardLabels.ATTRIBUTES)
        assertEquals(f.getJSONObject("races").toMap(), CardLabels.RACES)
        val pass = f.getJSONArray("passThrough")
        for (i in 0 until pass.length()) {
            val x = pass.getString(i)
            assertEquals(x, CardLabels.attribute(x))
            assertEquals(x, CardLabels.race(x))
        }
    }
}
