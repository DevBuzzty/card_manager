package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.EbayMarks
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/ebayMarks.test.js -- dieselbe Fixture docs/fixtures/ebay/marks.json. */
class EbayMarksTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/ebay/marks.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun status(o: JSONObject) = EbayMarks.Status(
        o.getString("environment"), o.getBoolean("connected"), str(o, "refresh_expires_at"),
        o.getBoolean("has_payment_policy"), str(o, "payment_policy_name"),
        o.getBoolean("has_fulfillment_policy"), str(o, "fulfillment_policy_name"),
        o.getBoolean("has_return_policy"), str(o, "return_policy_name"),
        o.getBoolean("has_location"), str(o, "location_key"),
    )
    private val known = status(fix.getJSONObject("status"))
    private fun state(k: String): EbayMarks.StatusState = when (k) {
        "U" -> EbayMarks.StatusState.Loading
        "N" -> EbayMarks.StatusState.None
        else -> EbayMarks.StatusState.Known(known)
    }
    private fun markOf(o: JSONObject?): EbayMarks.Mark? =
        o?.let { EbayMarks.Mark(it.getString("kind"), it.getString("text"), str(it, "url"), it.getBoolean("retry")) }

    @Test fun `Marken aller Fixture-Faelle`() {
        for (c in fix.getJSONArray("marks").objects()) {
            val l = c.getJSONObject("listing")
            val head = EbayMarks.ListingHead(l.getString("channel_id"), l.getString("status"), l.getBoolean("deleted"))
            val row = if (c.isNull("row")) null else c.getJSONObject("row").let {
                EbayMarks.Row(it.getString("environment"), it.getString("state"), str(it, "item_url"), str(it, "error"))
            }
            val want = if (c.isNull("mark")) null else markOf(c.getJSONObject("mark"))
            assertEquals(c.getString("name"), want, EbayMarks.mark(head, row, state(c.getString("status"))))
        }
    }
    @Test fun `Check-Liste`() {
        for (c in fix.getJSONArray("setup").objects()) {
            val s = if (c.getString("status") == "S") known else null
            val want = c.getJSONArray("items").objects().map { EbayMarks.SetupItem(it.getString("label"), it.getBoolean("ok")) }
            assertEquals(want, EbayMarks.setupItems(s))
            assertEquals(c.getBoolean("ok"), EbayMarks.setupOk(s))
        }
    }
    @Test fun `Ablauf-Hinweis 30 Tage vorher`() {
        for (c in fix.getJSONArray("expiry").objects()) {
            val s = if (c.optBoolean("disconnected", false)) known.copy(connected = false) else known
            assertEquals(c.getString("today"), str(c, "text"), EbayMarks.expiryText(s, c.getString("today")))
        }
    }
    @Test fun `Fotozaehler`() {
        for (c in fix.getJSONArray("photoCount").objects()) assertEquals(c.getString("text"), EbayMarks.photoCountText(c.getInt("n")))
    }
}
