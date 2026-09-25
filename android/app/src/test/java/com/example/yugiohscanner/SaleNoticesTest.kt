package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.SaleNotices
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/saleNotices.test.js -- dieselbe Fixture docs/fixtures/ebay/notices.json. */
class SaleNoticesTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/ebay/notices.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    // dismissed kommt in der Fixture als true/false oder 0/1 (lokal am PC) -- beides gilt.
    private fun bool(o: JSONObject, k: String): Boolean = when (val v = o.opt(k)) { is Boolean -> v; is Number -> v.toInt() != 0; else -> false }

    @Test fun `Hinweise offen, neueste zuerst`() {
        for (c in fix.getJSONArray("sort").objects()) {
            val list = c.getJSONArray("notices").objects().map {
                SaleNotices.Notice(it.getString("notice_id"), it.getString("kind"), it.getString("text"), str(it, "sale_id"),
                    str(it, "listing_id"), bool(it, "dismissed"), str(it, "created_at"))
            }
            val want = (0 until c.getJSONArray("ids").length()).map { c.getJSONArray("ids").getString(it) }
            assertEquals(c.getString("name"), want, SaleNotices.sort(list).map { it.noticeId })
        }
    }

    @Test fun `Beschriftung und Ton`() {
        for (c in fix.getJSONArray("labels").objects()) {
            assertEquals(c.getString("kind"), SaleNotices.Label(c.getString("label"), c.getString("tone")), SaleNotices.label(c.getString("kind")))
        }
    }

    @Test fun `Marke Gebuehren vorlaeufig`() {
        for (c in fix.getJSONArray("feesMark").objects()) {
            val o = c.getJSONObject("orders")
            val orders = o.keys().asSequence().associateWith {
                val x = o.getJSONObject(it); SaleNotices.OrderMark(x.getString("status"), x.getBoolean("fees_final"))
            }
            assertEquals(c.getString("name"), str(c, "mark"), SaleNotices.feesMark(orders, c.getString("saleId")))
        }
    }

    @Test fun `Titel der Start-Karte`() {
        for (c in fix.getJSONArray("startTitle").objects()) assertEquals(c.getString("text"), SaleNotices.title(c.getInt("count")))
    }
}
