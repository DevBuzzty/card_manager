package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SaleFlow
import com.example.yugiohscanner.ml.SalesMath
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING: desktop/src/utils/saleFlow.test.js liest dieselbe Fixture. Spec I §5.2. */
class SaleFlowTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/sales/sale-flow.json"))

    private fun JSONArray.objects() = List(length()) { getJSONObject(it) }
    private fun JSONObject.strOrNull(k: String) = if (isNull(k)) null else getString(k)
    private fun JSONObject.longOrNull(k: String) = if (!has(k) || isNull(k)) null else getLong(k)

    private fun errors(a: JSONArray) = a.objects().map { e ->
        val fix = if (e.isNull("fix")) null else e.getJSONObject("fix").let {
            SaleFlow.Fix(it.getString("label"), it.getString("field"), it.longOrNull("cents"), if (it.has("value")) it.getString("value") else null)
        }
        SaleFlow.FieldError(e.getString("field"), e.getString("text"), fix)
    }

    @Test fun `letzter Kanal`() {
        val lc = f.getJSONObject("lastChannel")
        for (c in lc.getJSONArray("faelle").objects()) {
            val sales = c.getJSONArray("sales").objects().mapIndexed { i, s ->
                SalesMath.SaleHead("s$i", s.getString("sold_on"), s.getString("channel_id"), s.getString("channel_id"), 1.0, null, null, s.getString("status"), false)
            }
            assertEquals(c.getString("name"), c.getString("channel"), SaleFlow.lastChannel(sales, lc.getString("fallback")))
        }
    }

    @Test fun `naechster Schritt und Beschriftungen`() {
        val ns = f.getJSONObject("nextSteps")
        val labels = ns.getJSONObject("labels")
        assertEquals(labels.keys().asSequence().associateWith { labels.getString(it) }, SaleFlow.NEXT_STEP_LABELS)
        for (c in ns.getJSONArray("faelle").objects()) {
            val steps = c.getJSONArray("steps").let { a -> List(a.length()) { a.getString(it) } }
            assertEquals(c.getString("name"), steps, SaleFlow.nextSteps(c.getString("way"), c.getInt("remaining"), c.strOrNull("listingId")))
        }
    }

    @Test fun `Verkauf pruefen`() {
        val vs = f.getJSONObject("validateSale")
        for (c in vs.getJSONArray("faelle").objects()) {
            val form = c.getJSONObject("form")
            val got = SaleFlow.validateSale(form.getString("gross"), form.getString("fees"), form.getString("shipping"),
                form.getString("sold_on"), c.longOrNull("suggestionCents"), vs.getString("today"))
            assertEquals(c.getString("name"), errors(c.getJSONArray("errors")), got)
        }
    }

    @Test fun `Angebot pruefen`() {
        for (c in f.getJSONObject("validateListing").getJSONArray("faelle").objects()) {
            val form = c.getJSONObject("form")
            val got = SaleFlow.validateListing(form.getString("price"), form.getString("url"), c.longOrNull("suggestionCents"))
            assertEquals(c.getString("name"), errors(c.getJSONArray("errors")), got)
        }
    }
}
