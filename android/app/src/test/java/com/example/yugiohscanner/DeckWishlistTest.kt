package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.CoverageCard
import com.example.yugiohscanner.ml.CoverageTotals
import com.example.yugiohscanner.ml.DeckWishlist
import com.example.yugiohscanner.ml.WishCandidate
import com.example.yugiohscanner.ml.WishPlan
import com.example.yugiohscanner.ml.WishResult
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckWishlist.test.js (Fixture docs/fixtures/decks/wishlist.json) und decks.test.cjs (eine Cloud-Suche). */
class DeckWishlistTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/wishlist.json"))
    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    @Test fun `Fixture Hoechstpreis`() {
        for (c in fix.getJSONArray("maxPrice").objects()) {
            assertEquals("${dbl(c, "cm_price")}", dbl(c, "max_price"), DeckWishlist.wishlistMaxPrice(dbl(c, "cm_price")))
        }
    }

    @Test fun `Fixture Auswahl`() {
        for (m in fix.getJSONArray("missing").objects()) {
            val cards = m.getJSONObject("coverage").getJSONArray("cards").objects().map {
                CoverageCard(it.getString("card_id"), 0, 0, 0, it.getInt("missing"), dbl(it, "price"), null, emptyList())
            }
            val coverage = Coverage(null, cards, CoverageTotals(0, 0, 0, 0, 0, 0.0, 0))
            val wl = m.getJSONArray("wishlist").let { a -> (0 until a.length()).map { a.getString(it) } }
            val e = m.getJSONObject("expected")
            val expected = WishPlan(
                e.getJSONArray("candidates").objects().map { WishCandidate(it.getString("card_id"), dbl(it, "max_price")) },
                e.getInt("alreadyListed"), e.getInt("withoutPrice"),
            )
            assertEquals(m.getString("name"), expected, DeckWishlist.missingForWishlist(coverage, wl))
        }
    }

    @Test fun `Fixture Bestaetigung und Rueckmeldung`() {
        for (c in fix.getJSONArray("confirm").objects()) {
            val plan = WishPlan(List(c.getInt("candidates")) { WishCandidate("$it", null) }, c.getInt("alreadyListed"), c.getInt("withoutPrice"))
            assertEquals(c.getString("text"), DeckWishlist.confirmText(plan))
        }
        for (r in fix.getJSONArray("result").objects()) {
            assertEquals(r.getString("text"), DeckWishlist.resultText(r.getInt("total"), r.getInt("added"), r.getInt("watches")))
        }
    }

    @Test fun `Cloud-Suche genau einmal und nur mit Watch`() = runTest {
        var scrapes = 0
        val items = listOf(WishCandidate("1", 10.79), WishCandidate("2", null), WishCandidate("3", 0.42), WishCandidate("4", 5.0))
        val res = DeckWishlist.addAll(items, add = { c ->
            if (c.cardId == "4") throw RuntimeException("kaputt")
            c.maxPrice != null
        }, triggerScrape = { scrapes++ })
        assertEquals(1, scrapes)
        assertEquals(WishResult(4, 3, 2, listOf("4")), res)

        var none = 0
        DeckWishlist.addAll(listOf(WishCandidate("2", null)), add = { false }, triggerScrape = { none++ })
        assertEquals(0, none)
    }

    // F3: ZWILLING von decks.test.cjs "ohne echten Namen kein Deal-Watch und keine Cloud-Suche".
    @Test fun `Deal-Watch nur mit echtem Namen`() {
        assertEquals(true, DeckWishlist.hasDealWatchName("Maxx \"C\"", "23434538"))
        assertEquals(false, DeckWishlist.hasDealWatchName("23434538", "23434538"))
        assertEquals(false, DeckWishlist.hasDealWatchName("", "23434538"))
        assertEquals(false, DeckWishlist.hasDealWatchName("   ", "23434538"))
    }

    @Test fun `Name fehlt -- Eintrag ja, Watch nein, keine Cloud-Suche wenn einziger Kandidat`() = runTest {
        var scrapes = 0
        val cardId = "12345678"
        // Simuliert WishlistRepository.addToWishlist: ohne Namen faellt er auf den Passcode zurueck.
        val res = DeckWishlist.addAll(listOf(WishCandidate(cardId, 5.0)), add = { c ->
            c.maxPrice != null && DeckWishlist.hasDealWatchName(cardId, c.cardId)
        }, triggerScrape = { scrapes++ })
        assertEquals(0, scrapes)
        assertEquals(WishResult(1, 1, 0, emptyList()), res)
    }
}
