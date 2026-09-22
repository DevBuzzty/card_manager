package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SalesMath
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ZWILLING von desktop/electron/listing-text.test.cjs -- dieselbe Fixture docs/fixtures/listings/listings.json. */
class ListingTextTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/listings/listings.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun strings(a: JSONArray) = (0 until a.length()).map { a.getString(it) }
    private fun longOrNull(o: JSONObject, k: String): Long? = if (o.isNull(k)) null else o.getLong(k)
    private fun item(o: JSONObject) = ListingText.Item(
        copyId = o.getString("copy_id"), cardId = o.getString("card_id"), name = str(o, "name"),
        setCode = o.getString("set_code"), language = o.getString("language"), rarity = o.getString("rarity"),
        edition = o.getString("edition"), condition = o.getString("condition"), nameEn = str(o, "name_en"),
        imageUrl = str(o, "image_url"), listingId = str(o, "listing_id") ?: "", deleted = o.optBoolean("deleted", false),
    )
    private val pool = fix.getJSONObject("items")
    private fun pick(a: JSONArray) = strings(a).map { item(pool.getJSONObject(it)) }
    private val board = fix.getJSONObject("board")
    private val base = board.getJSONObject("base")
    private val boardItems = board.getJSONArray("items").objects().map { o ->
        val merged = JSONObject(base.toString())
        for (k in o.keys()) merged.put(k, o.get(k))
        item(merged)
    }
    private fun head(o: JSONObject) = ListingText.Head(
        o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), str(o, "title"),
        SalesMath.toCents(o.getDouble("price"))!!, o.getString("status"), o.getString("listed_on"), str(o, "created_at"),
        str(o, "sale_id"), str(o, "external_url"), o.optBoolean("deleted", false),
    )
    private val listings = board.getJSONArray("listings").objects().map { head(it) }
    private val live = strings(board.getJSONArray("copyLive")).toSet()
    private fun liveOf(id: String) = boardItems.filter { it.listingId == id && !it.deleted }
    private fun offer(o: JSONObject) = ListingText.Offer(o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), o.getLong("priceCents"))

    @Test fun titel() {
        for (c in fix.getJSONArray("titles").objects()) {
            val t = ListingText.listingTitle(pick(c.getJSONArray("items")))
            assertEquals(c.getString("name"), c.getString("title"), t)
            assertEquals(c.getString("name"), c.getInt("length"), t.length)
            assertTrue(t.length <= ListingText.TITLE_MAX)
        }
    }
    @Test fun beschreibung() {
        for (c in fix.getJSONArray("descriptions").objects())
            assertEquals(c.getString("name"), c.getString("text"), ListingText.listingDescription(pick(c.getJSONArray("items")), longOrNull(c, "priceCents")))
    }
    @Test fun cardmarketAufteilung() {
        for (c in fix.getJSONArray("cardmarketGroups").objects()) {
            val exp = c.getJSONArray("groups").objects().map { listOf(it.getString("product"), it.getString("condition"), it.getInt("count"), strings(it.getJSONArray("copy_ids"))) }
            val got = ListingText.groupItems(pick(c.getJSONArray("items"))).map { listOf(ListingText.cardmarketProduct(it), it.condition, it.count, it.copyIds) }
            assertEquals(c.getString("name"), exp, got)
        }
    }
    @Test fun cardmarketEintragwerte() {
        for (c in fix.getJSONArray("cardmarketEntries").objects()) {
            val groups = ListingText.groupItems(pick(c.getJSONArray("items")))
            assertEquals(1, groups.size)
            val e = c.getJSONObject("entry")
            assertEquals(ListingText.CmEntry(e.getString("product"), e.getInt("quantity"), e.getString("language"), e.getString("condition"),
                e.getBoolean("firstEdition"), longOrNull(e, "pieceCents")), ListingText.cardmarketEntry(groups[0], longOrNull(c, "priceCents")))
        }
    }
    @Test fun stueckpreis() {
        for (c in fix.getJSONArray("pieceCents").objects())
            assertEquals(c.toString(), c.getLong("cents"), ListingText.pieceCents(c.getLong("total"), c.getInt("quantity")))
    }
    @Test fun verkaufAusAngebot() {
        for (c in fix.getJSONArray("afterSale").objects()) {
            val l = c.getJSONObject("listing"); val r = c.getJSONObject("result")
            assertEquals(c.getString("name"),
                ListingText.AfterSale(r.getString("status"), strings(r.getJSONArray("removeCopyIds")), r.getLong("priceCents"), r.getBoolean("askAdjust")),
                ListingText.afterListingSale(l.getString("channel_id"), l.getString("status"), SalesMath.toCents(l.getDouble("price"))!!,
                    strings(c.getJSONArray("live")), strings(c.getJSONArray("sold"))))
        }
    }
    @Test fun links() {
        for (c in fix.getJSONArray("links").objects())
            assertEquals(c.getString("channel_id"), str(c, "url"),
                ListingText.listingLink(c.getString("channel_id"), str(c, "cmUrl"), str(c, "nameEn"), str(c, "setCode")))
    }
    @Test fun kuerzelUndMarken() {
        for (c in fix.getJSONArray("shorts").objects())
            assertEquals(c.getString("channel_id"), c.getString("short"), ListingText.channelShort(c.getString("channel_id"), c.getString("name")))
        for (c in fix.getJSONArray("badges").objects())
            assertEquals(strings(c.getJSONArray("badges")), ListingText.copyBadges(c.getJSONArray("offers").objects().map { offer(it) }))
    }
    @Test fun bilder() {
        for (c in fix.getJSONArray("imageUrls").objects())
            assertEquals(strings(c.getJSONArray("urls")), ListingText.imageUrls(pick(c.getJSONArray("items"))))
        for (c in fix.getJSONArray("imagesText").objects())
            assertEquals(c.getString("text"), ListingText.imagesText(c.getInt("saved"), c.getInt("total")))
    }
    @Test fun seitNTagen() {
        for (c in fix.getJSONArray("since").objects()) {
            assertEquals(c.toString(), c.getInt("days"), ListingText.daysSince(c.getString("listed_on"), c.getString("today")))
            assertEquals(c.getString("text"), ListingText.sinceText(c.getInt("days")))
        }
    }
    @Test fun vorschlagsSumme() {
        for (c in fix.getJSONArray("suggestionSum").objects()) {
            val a = c.getJSONArray("values")
            val values = (0 until a.length()).map { if (a.isNull(it)) null else a.getLong(it) }
            assertEquals(a.toString(), longOrNull(c, "sum"), ListingText.suggestionSum(values))
        }
    }
    @Test fun texte() {
        for (c in fix.getJSONArray("summaryTexts").objects())
            assertEquals(c.getString("text"), ListingText.summaryText(ListingText.Summary(c.getInt("listings"), c.getInt("cards"), c.getLong("priceCents"))))
        for (c in fix.getJSONArray("startTexts").objects()) assertEquals(c.getString("text"), ListingText.startText(c.getInt("n")))
    }
    @Test fun zeilentitel() {
        for (c in fix.getJSONArray("rowTitleCases").objects()) {
            val l = c.getJSONObject("listing")
            assertEquals(c.getString("title"), ListingText.rowTitle(l.getString("channel_id"), str(l, "title"), pick(c.getJSONArray("items"))))
        }
        val rt = board.getJSONObject("rowTitles")
        for (id in rt.keys()) assertEquals(id, rt.getString(id), ListingText.rowTitle(listings.first { it.listingId == id }, liveOf(id)))
    }
    @Test fun marken() {
        val sugg = board.getJSONObject("suggestions")
        val status = board.getJSONObject("saleStatus")
        val got = ListingText.listingMarks(listings, boardItems, { it in live }, { str(status, it) }, { if (!sugg.has(it) || sugg.isNull(it)) null else sugg.getLong(it) })
        val m = board.getJSONObject("marks")
        val exp = m.keys().asSequence().associateWith { k ->
            val o = m.getJSONObject(k)
            ListingText.Marks(strings(o.getJSONArray("alsoOn")), o.getBoolean("missing"), o.getBoolean("underSuggestion"), o.getBoolean("saleCancelled"))
        }
        assertEquals(exp, got)
    }
    @Test fun sortierungUndKopf() {
        assertEquals(strings(board.getJSONArray("order")), ListingText.sortListings(listings).map { it.listingId })
        val s = board.getJSONObject("summary")
        val got = ListingText.listingsSummary(listings, boardItems)
        assertEquals(ListingText.Summary(s.getInt("listings"), s.getInt("cards"), s.getLong("priceCents")), got)
        assertEquals(board.getString("summaryText"), ListingText.summaryText(got))
    }
    @Test fun angeboteJeExemplar() {
        val by = ListingText.activeByCopy(listings, boardItems)
        val e = board.getJSONObject("byCopy")
        assertEquals(e.keys().asSequence().associateWith { k -> e.getJSONArray(k).objects().map { offer(it) } }, by)
        val t = board.getJSONObject("offeredText")
        for (id in t.keys()) assertEquals(id, str(t, id), ListingText.offeredText(by[id] ?: emptyList()))
    }
    @Test fun aufraeumen() {
        for (c in board.getJSONArray("cleanup").objects()) {
            val r = c.getJSONObject("result")
            val exp = ListingText.Cleanup(
                r.getJSONArray("removeItems").objects().map { ListingText.RemoveItem(it.getString("listing_id"), it.getString("copy_id")) },
                strings(r.getJSONArray("endListings")),
                r.getJSONArray("remind").objects().map { ListingText.Remind(it.getString("listing_id"), it.getString("channel_name"), it.getString("title"), str(it, "external_url")) },
            )
            assertEquals(c.getString("name"), exp, ListingText.cleanupAfterSale(listings, boardItems, strings(c.getJSONArray("sold")), str(c, "except")))
        }
    }
}
