package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.CopyRowText
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING: desktop/src/utils/copyRow.test.js liest dieselbe Fixture. Spec I §4.1. */
class CopyRowTextTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/copies/copy-row.json"))

    private fun JSONObject.strOrNull(k: String) = if (isNull(k)) null else getString(k)
    private fun JSONObject.intOrNull(k: String) = if (isNull(k)) null else getInt(k)

    @Test fun `Auflage-Beschriftungen der App sind die der Fixture`() {
        val e = f.getJSONObject("editionen")
        assertEquals(e.keys().asSequence().associateWith { e.getString(it) }, Valuation.EDITION_LABELS)
        assertEquals(f.getString("ohneBehaelter"), CopyRowText.UNSORTED)
    }

    @Test fun `Jeder Fixture-Fall ergibt dieselbe Zeile`() {
        val faelle = f.getJSONArray("faelle")
        for (i in 0 until faelle.length()) {
            val c = faelle.getJSONObject(i)
            val cp = c.getJSONObject("copy")
            // Am Handy sind Zustand und Auflage nie null; ein fehlender Wert kommt als leerer Text an.
            val copy = CopyRow(
                copyId = "c$i", cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
                edition = cp.strOrNull("edition") ?: "", condition = cp.strOrNull("condition") ?: "", deleted = false,
                containerId = cp.strOrNull("container_id"), page = cp.intOrNull("page"), slot = cp.intOrNull("slot"),
                tags = null, note = null, forSale = cp.getInt("for_sale") == 1,
            )
            val container = if (c.isNull("container")) null else c.getJSONObject("container").let {
                ContainerRow(it.getString("container_id"), it.getString("name"), it.getString("kind"), null, null, 0)
            }
            val marks = c.getJSONArray("marks").let { a -> List(a.length()) { a.getString(it) } }
            val expected = CopyRowText.Line(c.getString("lead"), c.getString("location"), c.getBoolean("unsorted"), marks)
            assertEquals(c.getString("name"), expected, CopyRowText.of(copy, container, c.getInt("angebote")))
        }
    }
}
