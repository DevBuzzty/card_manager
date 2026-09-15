package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.ml.SealedValue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** ZWILLING von desktop/electron/sealed-value.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/sealed-value.json. */
class SealedValueTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/portfolio/sealed-value.json"))

    private fun item(o: JSONObject) = SealedItem(
        sealedId = o.optString("sealed_id", "x"),
        cmProductId = o.optLong("cm_product_id", 1L),
        name = o.optString("name", ""),
        kind = o.optString("kind", "display"),
        quantity = o.getInt("quantity"),
        price = if (o.isNull("price")) null else o.getDouble("price"),
        priceUpdatedAt = null,
        deleted = when (val d = o.opt("deleted")) {
            is Boolean -> d
            is Number -> d.toInt() != 0
            else -> false
        },
    )

    private fun items(a: JSONArray) = (0 until a.length()).map { item(a.getJSONObject(it)) }

    @Test fun `Sealed-Wert`() {
        val cases = fix.getJSONArray("value")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.getString("name"), c.getDouble("value"), SealedValue.sealedValue(items(c.getJSONArray("items"))), 1e-9)
        }
    }

    @Test fun `Preis veraltet`() {
        val now = Instant.parse(fix.getString("now")).toEpochMilli()
        val cases = fix.getJSONArray("stale")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val ts = if (c.isNull("price_updated_at")) null else c.getString("price_updated_at")
            assertEquals(c.getString("name"), c.getBoolean("stale"), SealedValue.isPriceStale(ts, now))
        }
    }

    @Test fun `Art-Bezeichnungen`() {
        val cases = fix.getJSONArray("kinds")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val kind = if (c.isNull("kind")) null else c.getString("kind")
            assertEquals("$kind", c.getString("label"), SealedValue.kindLabel(kind))
        }
        assertEquals(listOf("display", "booster", "tin", "deck", "special", "other"), SealedValue.KIND_LABELS.keys.toList())
    }

    @Test fun `Reihenfolge der Liste`() {
        val cases = fix.getJSONArray("order")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = c.getJSONArray("expected").let { a -> (0 until a.length()).map { a.getString(it) } }
            assertEquals(c.getString("name"), expected, SealedValue.sortSealed(items(c.getJSONArray("items"))).map { it.sealedId })
        }
    }
}
