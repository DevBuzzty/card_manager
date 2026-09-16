package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckCoverage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckCoverage.test.js -- dieselbe Fixture docs/fixtures/decks/coverage.json. */
class DeckCoverageTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/coverage.json"))
    private val w = DeckFixtureWorld(fix.getJSONObject("world"))
    private val worldPrices = DeckFixtureWorld.prices(fix.getJSONObject("world").getJSONObject("prices"))

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)
    private fun str(o: JSONObject, k: String): String? = if (o.isNull(k)) null else o.getString(k)

    @Test fun `alle Fixture-Faelle`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val deckId = c.getLong("deckId")
            val prices = if (c.has("prices")) DeckFixtureWorld.prices(c.getJSONObject("prices")) else worldPrices
            val cov = DeckCoverage.compute(deckId, DeckFixtureWorld.deckCards(c.getJSONArray("deckCards")), w.copies, w.cards, w.decks, w.containers, prices)
            val e = c.getJSONObject("expected")
            assertEquals("$name boxId", str(e, "boxId"), cov.boxId)

            val ec = e.getJSONArray("cards").objects()
            assertEquals("$name cards", ec.size, cov.cards.size)
            cov.cards.zip(ec).forEach { (got, exp) ->
                val n = "$name ${exp.getString("card_id")}"
                assertEquals(n, exp.getString("card_id"), got.cardId)
                assertEquals("$n needed", exp.getInt("needed"), got.needed)
                assertEquals("$n inBox", exp.getInt("inBox"), got.inBox)
                assertEquals("$n available", exp.getInt("available"), got.available)
                assertEquals("$n missing", exp.getInt("missing"), got.missing)
                assertEquals("$n price", dbl(exp, "price"), got.price)
                assertEquals("$n missingCost", dbl(exp, "missingCost"), got.missingCost)
                assertEquals("$n reserved", exp.getJSONArray("reservedElsewhere").objects().map { Triple(it.getLong("deck_id"), it.getString("name"), it.getInt("count")) },
                    got.reservedElsewhere.map { Triple(it.deckId, it.name, it.count) })
            }

            val t = e.getJSONObject("totals")
            assertEquals("$name needed", t.getInt("needed"), cov.totals.needed)
            assertEquals("$name owned", t.getInt("owned"), cov.totals.owned)
            assertEquals("$name boxed", t.getInt("boxed"), cov.totals.boxed)
            assertEquals("$name missing", t.getInt("missing"), cov.totals.missing)
            assertEquals("$name missingCards", t.getInt("missingCards"), cov.totals.missingCards)
            assertEquals("$name cost", t.getDouble("cost"), cov.totals.cost, 1e-9)
            assertEquals("$name unpriced", t.getInt("unpriced"), cov.totals.unpriced)

            val x = e.getJSONObject("texts")
            val deck = w.decks.first { it.id == deckId }
            assertEquals("$name box", x.getString("box"), DeckCoverage.boxLabel(deck, w.containers))
            assertEquals("$name header", x.getString("header"), DeckCoverage.headerText(cov))
            assertEquals("$name list", x.getString("list"), DeckCoverage.listText(cov))
            assertEquals("$name cost", str(x, "cost"), DeckCoverage.costText(cov.totals))
            val rows = x.getJSONArray("rows")
            assertEquals("$name rows", (0 until rows.length()).map { rows.getString(it) }, cov.cards.map { DeckCoverage.rowText(it) })
            val reserved = x.getJSONArray("reserved")
            assertEquals("$name reserved", (0 until reserved.length()).map { i -> reserved.getJSONArray(i).let { a -> (0 until a.length()).map { a.getString(it) } } },
                cov.cards.map { DeckCoverage.reservedTexts(it) })
        }
    }

    @Test fun `Fixture Deckbox-Auswahl`() {
        for (c in fix.getJSONArray("choices").objects()) {
            val ids = c.getJSONArray("container_ids")
            assertEquals("Deck ${c.getLong("deckId")}", (0 until ids.length()).map { ids.getString(it) },
                DeckCoverage.deckBoxChoices(c.getLong("deckId"), w.decks, w.containers).map { it.containerId })
        }
    }

    @Test fun `Platzhalter ist nie eine Null`() {
        assertEquals("…", DeckCoverage.LOADING)
    }
}
