package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.FillBoxProposal
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** ZWILLING von desktop/src/utils/fillBoxProposal.test.js -- dieselbe Fixture docs/fixtures/decks/fill-box.json. */
class FillBoxProposalTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/fill-box.json"))
    private val w = DeckFixtureWorld(fix.getJSONObject("world"))

    @Test fun `alle Fixture-Faelle`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val got = FillBoxProposal.compute(c.getLong("deckId"), DeckFixtureWorld.deckCards(c.getJSONArray("deckCards")), w.copies, w.cards, w.decks, w.containers)
            if (c.isNull("expected")) { assertNull(name, got); continue }
            val e = c.getJSONObject("expected")
            assertEquals("$name rows", e.getJSONArray("rows").objects().map { Triple(it.getString("copy_id"), it.getString("card_id"), it.getInt("group")) },
                got!!.rows.map { Triple(it.copy.copyId, it.copy.cardId, it.group) })
            assertEquals("$name short", e.getInt("short"), got.short)
            assertEquals("$name surplus", e.getInt("surplus"), got.surplus)
        }
    }

    @Test fun `Fixture Ortstext`() {
        val byId = w.containers.associateBy { it.containerId }
        for (l in fix.getJSONArray("location").objects()) {
            val o = l.getJSONObject("copy")
            val cid = if (o.isNull("container_id")) null else o.getString("container_id")
            val copy = CopyRow("x", "1", "X", "DE", "Common", "unknown", "NM", false,
                containerId = cid, page = if (o.isNull("page")) null else o.getInt("page"),
                slot = if (o.isNull("slot")) null else o.getInt("slot"), tags = null, note = null)
            assertEquals(l.getString("name"), l.getString("text"), FillBoxProposal.locationText(copy, cid?.let { byId[it] }))
        }
    }

    @Test fun `Fixture Hinweistexte`() {
        for (t in fix.getJSONArray("texts").objects()) {
            val n = t.getInt("n")
            assertEquals("short $n", if (t.isNull("short")) null else t.getString("short"), FillBoxProposal.shortText(n))
            assertEquals("surplus $n", if (t.isNull("surplus")) null else t.getString("surplus"), FillBoxProposal.surplusText(n))
        }
    }
}
