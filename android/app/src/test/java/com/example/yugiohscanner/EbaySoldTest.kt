package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbaySold
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class EbaySoldTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/ebay/sold-line.json"))

    private fun row(o: JSONObject?): EbaySold.SoldRow? = o?.let {
        EbaySold.SoldRow(
            status = it.getString("status"),
            medianAll = if (it.isNull("median_all")) null else it.getDouble("median_all"),
            nAll = it.getInt("n_all"),
            medianFirst = if (it.isNull("median_first")) null else it.getDouble("median_first"),
            nFirst = it.getInt("n_first"),
            lastSoldAt = if (it.isNull("last_sold_at")) null else it.getString("last_sold_at"),
            sales = emptyList(),
        )
    }

    @Test
    fun `Fixture eBay-Zeile`() {
        val cases = fix.getJSONArray("line")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val r = if (c.isNull("row")) null else row(c.getJSONObject("row"))
            assertEquals(c.getString("name"), c.getString("line"), EbaySold.line(c.getString("access"), r))
            assertEquals(c.getString("name"), c.getBoolean("canCheck"), EbaySold.canCheck(c.getString("access")))
        }
    }
}
