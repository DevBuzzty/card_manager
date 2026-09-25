package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Selection
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/selection.test.js -- dieselbe Fixture docs/fixtures/copies/selection.json. */
class SelectionTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/copies/selection.json"))
    private fun strs(a: JSONArray) = (0 until a.length()).map { a.getString(it) }

    private val groups = f.getJSONArray("groups").objects().map { g ->
        g.getString("id") to g.getJSONArray("variants").objects().map {
            CardRow(it.getString("id"), it.getString("set_code"), it.getString("language"), null, null, it.getString("rarity"), 1, null)
        }
    }
    private val copies = f.getJSONArray("copies").objects().map {
        CopyRow(it.getString("copy_id"), it.getString("card_id"), it.getString("set_code"), it.getString("language"), it.getString("rarity"),
            "unknown", "NM", it.getBoolean("deleted"), if (it.isNull("container_id")) null else it.getString("container_id"), null, null, null, null)
    }

    @Test fun `Exemplare der Auswahl`() {
        for (c in f.getJSONArray("cases").objects()) {
            val got = Selection.copies(groups, strs(c.getJSONArray("selected")).toSet(), copies, strs(c.getJSONArray("containers")).toSet())
            assertEquals(c.getString("name"), strs(c.getJSONArray("copyIds")), got.map { it.copyId })
        }
    }

    @Test fun `Texte`() {
        for (c in f.getJSONArray("selectionTexts").objects()) assertEquals(c.getString("text"), Selection.text(c.getInt("cards"), c.getInt("copies")))
        for (c in f.getJSONArray("sellSubtitles").objects()) assertEquals(c.getString("text"), Selection.sellSubtitle(c.getInt("cards"), c.getInt("copies")))
        for (c in f.getJSONArray("moveTexts").objects()) {
            assertEquals(c.getString("text"), Selection.moveText(c.getInt("count"), if (c.isNull("target")) null else c.getString("target")))
        }
    }
}
