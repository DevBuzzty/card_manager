package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.SalesMath
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/sales-math.test.cjs -- dieselbe Fixture docs/fixtures/sales/sales.json. */
class SalesMathTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/sales/sales.json"))
    private fun dbl(o: JSONObject, k: String): Double? =
        if (!o.has(k) || o.isNull(k) || o.optString(k) == "") null else o.getDouble(k)
    private fun longs(a: org.json.JSONArray) = (0 until a.length()).map { a.getLong(it) }
    private val stats = fix.getJSONObject("stats")
    private val sales = stats.getJSONArray("sales").objects().map {
        SalesMath.SaleHead(it.getString("sale_id"), it.getString("sold_on"), it.getString("channel_id"), it.getString("channel_name"),
            it.getDouble("gross"), dbl(it, "fees"), dbl(it, "shipping"), it.getString("status"), it.getBoolean("deleted"))
    }
    private val items = stats.getJSONArray("items").objects().map {
        SalesMath.SaleLine(it.getString("sale_id"), it.getString("copy_id"), it.getDouble("value_at_sale"), it.getDouble("share"), it.getBoolean("deleted"))
    }
    private val soldIn = stats.getJSONObject("soldIn")
    private val soldInOf: (String) -> String? = { id -> if (!soldIn.has(id) || soldIn.isNull(id)) null else soldIn.getString(id) }
    private val today = stats.getString("today")

    @Test fun marktwert() {
        for (c in fix.getJSONArray("marketValue").objects()) {
            val card = c.getJSONObject("card"); val copy = c.getJSONObject("copy")
            assertEquals(c.getString("name"), c.getLong("cents"),
                SalesMath.marketValueCents(dbl(card, "price"), dbl(card, "price_first_ed"), copy.getString("edition"), copy.getString("condition")))
        }
    }
    @Test fun netto() {
        for (c in fix.getJSONArray("net").objects()) {
            val s = c.getJSONObject("sale")
            assertEquals(c.getLong("cents"), SalesMath.netCents(dbl(s, "gross"), dbl(s, "fees"), dbl(s, "shipping")))
        }
    }
    @Test fun gebuehr() {
        for (c in fix.getJSONArray("feeDefault").objects())
            assertEquals(c.getLong("cents"), SalesMath.feeDefaultCents(c.getLong("grossCents"), c.getDouble("percent")))
    }
    @Test fun verteilung() {
        for (c in fix.getJSONArray("distribute").objects()) {
            val s = SalesMath.distribute(c.getLong("net"), longs(c.getJSONArray("values")))
            assertEquals(c.getString("name"), longs(c.getJSONArray("shares")), s)
            assertEquals(c.getLong("net"), s.sum())
        }
    }
    @Test fun vorschlag() {
        for (c in fix.getJSONArray("suggestion").objects()) {
            val v = if (c.isNull("value")) null else c.getLong("value")
            val exp = if (c.isNull("cents")) null else c.getLong("cents")
            assertEquals(c.getString("name"), exp, SalesMath.suggestionCents(v, c.getInt("discount"), c.getLong("min")))
        }
    }
    @Test fun normalisieren() {
        val n = fix.getJSONObject("normalize")
        for (c in n.getJSONArray("discount").objects())
            assertEquals(c.opt("raw").toString(), c.getInt("out"), SalesMath.normalizeDiscount(if (c.isNull("raw")) null else c.getString("raw")))
        for (c in n.getJSONArray("minPrice").objects())
            assertEquals(c.opt("raw").toString(), c.getLong("out"), SalesMath.normalizeMinPrice(if (c.isNull("raw")) null else c.getString("raw")))
    }
    @Test fun texte() {
        for (c in fix.getJSONArray("texts").objects())
            assertEquals(c.getString("diff"), SalesMath.diffText(c.getLong("net"), c.getLong("market")))
        for (c in fix.getJSONArray("euro").objects())
            assertEquals(c.getString("text"), SalesMath.euroCentsText(c.getLong("cents")))
    }
    @Test fun doppelverkauf() {
        val exp = (0 until stats.getJSONArray("doubleSold").length()).map { stats.getJSONArray("doubleSold").getString(it) }
        assertEquals(exp, SalesMath.doubleSold(sales, items).sorted())
    }
    @Test fun kennzahlen() {
        for (p in listOf("monat", "jahr", "gesamt")) {
            val e = stats.getJSONObject("periods").getJSONObject(p)
            assertEquals(p, SalesMath.Totals(e.getLong("netCents"), e.getLong("marketCents"), e.getLong("feesCents"), e.getInt("sales"), e.getInt("cards")),
                SalesMath.totals(SalesMath.periodFilter(sales, p, today), items, soldInOf))
        }
    }
    @Test fun jeKanal() {
        val exp = stats.getJSONArray("byChannelGesamt").objects().map {
            SalesMath.ChannelRow(it.getString("channel_id"), it.getString("channel_name"), it.getInt("sales"), it.getLong("netCents"), it.getLong("feesCents"), it.getLong("diffCents"))
        }
        assertEquals(exp, SalesMath.byChannel(SalesMath.periodFilter(sales, "gesamt", today), items, soldInOf))
    }
    @Test fun jeMonat() {
        val exp = stats.getJSONArray("byMonthLast3").objects().map { SalesMath.MonthRow(it.getString("month"), it.getLong("netCents")) }
        assertEquals(exp, SalesMath.byMonth(sales, items, soldInOf, today, 3))
    }
    @Test fun verkaufsliste() {
        val bySaleId = sales.associateBy { it.saleId }
        for (c in stats.getJSONArray("listValues").objects()) {
            val sale = bySaleId.getValue(c.getString("sale_id"))
            assertEquals(c.getString("sale_id"),
                SalesMath.ListValues(c.getLong("netCents"), c.getLong("marketCents")),
                SalesMath.listValues(sale, items, soldInOf))
        }
    }
    @Test fun ohneVerkauftesExemplar() {
        val o = fix.getJSONObject("orphaned")
        val oSales = o.getJSONArray("sales").objects().map {
            SalesMath.SaleHead(it.getString("sale_id"), it.getString("sold_on"), it.getString("channel_id"), it.getString("channel_name"),
                it.getDouble("gross"), dbl(it, "fees"), dbl(it, "shipping"), it.getString("status"), it.getBoolean("deleted"))
        }
        val oItems = o.getJSONArray("items").objects().map {
            SalesMath.SaleLine(it.getString("sale_id"), it.getString("copy_id"), it.getDouble("value_at_sale"), it.getDouble("share"), it.getBoolean("deleted"))
        }
        val oSoldIn = o.getJSONObject("soldIn")
        val of: (String) -> String? = { id -> if (!oSoldIn.has(id) || oSoldIn.isNull(id)) null else oSoldIn.getString(id) }
        val exp = (0 until o.getJSONArray("expected").length()).map { o.getJSONArray("expected").getString(it) }
        assertEquals(exp, SalesMath.orphanedSales(oSales, oItems, of).sorted())
        assertEquals(emptyList<String>(), SalesMath.orphanedSales(sales, items, soldInOf).sorted())
    }
}
