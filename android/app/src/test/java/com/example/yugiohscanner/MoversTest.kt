package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Movers
import com.example.yugiohscanner.ml.PriceRef
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/movers.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/movers.json. */
class MoversTest {
    private fun JSONObject.strOrNull(k: String): String? = if (isNull(k)) null else getString(k)

    private fun cards(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        CardRow(
            id = o.getString("id"), setCode = o.getString("set_code"), language = o.getString("language"),
            name = o.strOrNull("name"), imageUrl = o.strOrNull("image_url"), rarity = o.strOrNull("rarity"),
            quantity = 1, price = if (o.isNull("price")) null else o.getDouble("price"),
            deleted = o.optBoolean("deleted", false), priceLocked = o.optInt("price_locked", 0),
        )
    }

    private fun copies(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        CopyRow(
            copyId = "c$i", cardId = o.getString("card_id"), setCode = o.getString("set_code"),
            language = o.getString("language"), rarity = o.getString("rarity"), edition = "unknown",
            condition = o.getString("condition"), deleted = o.optBoolean("deleted", false),
            containerId = null, page = null, slot = null, tags = null, note = null,
        )
    }

    private fun refs(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        PriceRef(o.getString("card_id"), o.getString("set_code"), o.getString("language"), o.getString("rarity"),
            o.getString("day"), o.getDouble("price"), o.getString("source"))
    }

    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/movers.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val inp = c.getJSONObject("input")
            val exp = c.getJSONObject("expected")
            val r = Movers.compute(
                cards(inp.getJSONArray("cards")), copies(inp.getJSONArray("copies")), refs(inp.getJSONArray("references")),
                inp.getString("today"), inp.getInt("days"), inp.getInt("top"),
            )
            assertEquals(name, exp.getString("status"), r.status)
            assertEquals(name, if (exp.isNull("firstDay")) null else exp.getString("firstDay"), r.firstDay)
            for ((listName, got) in listOf("winners" to r.winners, "losers" to r.losers)) {
                val e = exp.getJSONArray(listName)
                assertEquals("$name $listName", e.length(), got.size)
                got.forEachIndexed { j, m ->
                    val x = e.getJSONObject(j)
                    val at = "$name $listName[$j]"
                    assertEquals(at, x.getString("key"), m.key)
                    assertEquals(at, x.getInt("copies"), m.copies)
                    assertEquals(at, x.getDouble("oldPrice"), m.oldPrice, 1e-9)
                    assertEquals(at, x.getDouble("newPrice"), m.newPrice, 1e-9)
                    assertEquals(at, x.getDouble("deltaUnit"), m.deltaUnit, 1e-9)
                    if (x.isNull("pct")) assertEquals(at, null, m.pct) else assertEquals(at, x.getDouble("pct"), m.pct!!, 1e-9)
                    assertEquals(at, x.getDouble("weight"), m.weight, 1e-9)
                    assertEquals(at, x.getDouble("deltaHolding"), m.deltaHolding, 1e-9)
                }
            }
        }
    }
}
