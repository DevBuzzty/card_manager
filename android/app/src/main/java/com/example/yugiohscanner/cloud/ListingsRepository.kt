package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.ListingText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Spec H3a §4.2/§4.3/§7 -- Angebote über REST (supabase/listings_schema.sql), keine Datenbankfunktion. Bauart wie
 * SalesRepository (Auth-Kopf, executeWithReauth bei 401, Blättern per KeysetPager, PostgREST kappt limit bei 1000).
 * Jede Schreibaktion ist als reine [Op]-Liste beschrieben (testbar ohne Server) und wird der Reihe nach ausgeführt.
 * Abweichung 1: Anlegen schreibt listing_items -> listings -> for_sale nacheinander; ein Abbruch hinterlässt höchstens
 * unsichtbare Positionen ohne Kopf.
 */
object ListingsRepository {
    const val CHANGED = "Angebot wurde inzwischen geändert – bitte neu öffnen."
    private const val LISTING_COLS =
        "listing_id,channel_id,channel_name,title,description,price,status,listed_on,sale_id,external_url,note,created_at,deleted"
    private const val ITEM_COLS = "listing_id,copy_id,card_id,set_code,language,rarity,edition,condition,name,image_url,deleted"
    private val DATE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    private val URL_OK = Regex("^https?://", RegexOption.IGNORE_CASE)

    /** Eine REST-Schreibaktion. [expectRow]: PATCH mit return=representation, eine leere Antwort heißt [CHANGED]. */
    data class Op(val method: String, val table: String, val params: List<Pair<String, String>>, val body: String, val expectRow: Boolean = false)
    data class AfterBooking(val reminders: List<ListingText.Remind>, val askAdjust: Boolean, val listingSkipped: Boolean)

    private fun num(o: JSONObject, k: String): Double? {
        if (!o.has(k) || o.isNull(k)) return null
        return when (val v = o.get(k)) { is Number -> v.toDouble(); is String -> v.toDouble(); else -> null }
    }
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun String?.orNull(): Any = this?.trim()?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL

    internal fun parseListings(text: String): List<ListingRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingRow(o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), str(o, "title"),
                str(o, "description"), num(o, "price") ?: 0.0, o.getString("status"), o.getString("listed_on").take(10),
                str(o, "sale_id"), str(o, "external_url"), str(o, "note"), str(o, "created_at"), o.optBoolean("deleted", false))
        }
    }
    internal fun parseItems(text: String): List<ListingItemRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingItemRow(o.getString("listing_id"), o.getString("copy_id"), o.getString("card_id"), o.getString("set_code"),
                o.getString("language"), o.getString("rarity"), o.getString("edition"), o.getString("condition"),
                str(o, "name"), str(o, "image_url"), o.optBoolean("deleted", false))
        }
    }

    internal fun listingsPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to LISTING_COLS, "deleted" to "eq.false", "order" to "listing_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id"), listOf(after))
        return p
    }
    internal fun itemsPageParams(after: ListingItemRow?): List<Pair<String, String>> {
        val p = arrayListOf("select" to ITEM_COLS, "deleted" to "eq.false", "order" to "listing_id.asc,copy_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id", "copy_id"), listOf(after.listingId, after.copyId))
        return p
    }

    suspend fun load(): ListingsData {
        val listings = KeysetPager.all(StoreQueries.PAGE) { after: ListingRow? ->
            parseListings(getText("listings", listingsPageParams(after?.listingId), "Angebote laden"))
        }
        val items = KeysetPager.all(StoreQueries.PAGE) { after: ListingItemRow? ->
            parseItems(getText("listing_items", itemsPageParams(after), "Positionen laden"))
        }
        return ListingsData(listings, items)
    }

    internal fun inList(ids: List<String>) = "in.(${ids.joinToString(",") { Keyset.quote(it) }})"
    private fun activeFilter(id: String) = listOf("listing_id" to "eq.$id", "status" to "eq.aktiv", "deleted" to "eq.false")
    private fun itemsFilter(listingId: String, copyIds: List<String>) =
        listOf("listing_id" to "eq.$listingId", "copy_id" to inList(copyIds), "deleted" to "eq.false")
    private val DELETED = JSONObject().put("deleted", true).toString()
    private val ENDED = JSONObject().put("status", "beendet").toString()

    /**
     * Spec §5.7/Abweichung 8 -- Preis- und Link-Prüfung, geteilt zwischen Anlegen ([checkNew]) und Bearbeiten
     * ([update]). Dieselben Texte wie listings.cjs#checkFields.
     */
    internal fun checkEdit(priceCents: Long?, externalUrl: String?): String? = when {
        priceCents != null && priceCents <= 0 -> "Der Angebotspreis muss über 0 € liegen."
        !externalUrl.isNullOrBlank() && !URL_OK.containsMatchIn(externalUrl.trim()) -> "Der Link muss mit http:// oder https:// beginnen."
        else -> null
    }

    /** Spec §5.7 -- dieselben Prüfungen und Texte wie listings.cjs#createOne, in derselben Reihenfolge. */
    internal fun checkNew(l: NewListing, liveCopyIds: Set<String>, liveChannelIds: Set<String>): String? = when {
        l.items.isEmpty() -> "Mindestens eine Karte auswählen."
        !DATE.matches(l.listedOn) -> "Ungültiges Datum."
        else -> checkEdit(l.priceCents, l.externalUrl) ?: when {
            l.channelId !in liveChannelIds -> "Kanal nicht gefunden."
            l.items.any { it.copyId !in liveCopyIds } -> "Karte bereits verkauft oder gelöscht."
            l.channelId == "cardmarket" && ListingText.groupItems(l.items).size != 1 ->
                "Ein Cardmarket-Angebot enthält nur gleiche Karten (Druck, Sprache, Zustand, Auflage)."
            else -> null
        }
    }

    internal fun createOps(ids: List<String>, list: List<NewListing>): List<Op> {
        val items = JSONArray()
        val heads = JSONArray()
        list.forEachIndexed { i, l ->
            val id = ids[i]
            val cm = l.channelId == "cardmarket"
            heads.put(JSONObject().put("listing_id", id).put("channel_id", l.channelId).put("channel_name", l.channelName)
                .put("title", if (cm) JSONObject.NULL else l.title.orNull())
                .put("description", if (cm) JSONObject.NULL else l.description.orNull())
                .put("price", l.priceCents / 100.0).put("listed_on", l.listedOn)
                .put("external_url", l.externalUrl.orNull()).put("note", l.note.orNull()))
            for (item in l.items.sortedBy { it.copyId }) {
                items.put(JSONObject().put("listing_id", id).put("copy_id", item.copyId).put("card_id", item.cardId)
                    .put("set_code", item.setCode).put("language", item.language).put("rarity", item.rarity).put("edition", item.edition)
                    .put("condition", item.condition).put("name", item.name ?: JSONObject.NULL).put("image_url", item.imageUrl ?: JSONObject.NULL))
            }
        }
        return listOf(Op("POST", "listing_items", emptyList(), items.toString()), Op("POST", "listings", emptyList(), heads.toString()))
    }

    /** Legt die Angebote an und setzt danach for_sale (Spec §5.2). Gibt die neuen listing_ids zurück. */
    suspend fun create(list: List<NewListing>): List<String> {
        val ids = list.map { UUID.randomUUID().toString() }
        run(createOps(ids, list))
        try {
            CollectionRepository.setForSale(list.flatMap { l -> l.items.map { it.copyId } }.distinct(), true)
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { throw IllegalStateException("Angebot gespeichert, „Zum Verkauf“ nicht gesetzt: ${e.message}") }
        return ids
    }

    internal fun removeOps(listingId: String, removeCopyIds: List<String>, liveCopyIds: List<String>): List<Op> {
        val live = liveCopyIds.distinct()
        val remove = removeCopyIds.distinct().filter { it in live }.sorted()
        if (remove.isEmpty()) return emptyList()
        val ops = arrayListOf(Op("PATCH", "listing_items", itemsFilter(listingId, remove), DELETED))
        if (live.all { it in remove }) ops += Op("PATCH", "listings", activeFilter(listingId), ENDED)
        return ops
    }

    internal fun updateOps(
        l: ListingRow, priceCents: Long, title: String?, description: String?, externalUrl: String?, note: String?,
        removeCopyIds: List<String>, liveCopyIds: List<String>,
    ): List<Op> {
        val cm = l.channelId == "cardmarket"
        val body = JSONObject().put("price", priceCents / 100.0)
            .put("title", if (cm) JSONObject.NULL else title.orNull())
            .put("description", if (cm) JSONObject.NULL else description.orNull())
            .put("external_url", externalUrl.orNull()).put("note", note.orNull())
        return listOf(Op("PATCH", "listings", activeFilter(l.listingId), body.toString(), expectRow = true)) +
            removeOps(l.listingId, removeCopyIds, liveCopyIds)
    }

    /**
     * Bearbeiten; [fresh] = innerhalb des InFlight-Gatters frisch geladen. -> true, wenn das Angebot dabei endete.
     * Prüft Preis/Link ([checkEdit], Abweichung 8) vor jedem Schreibzugriff -- dieselben Texte wie beim Anlegen.
     */
    suspend fun update(fresh: ListingsData, listingId: String, priceCents: Long, title: String?, description: String?,
                       externalUrl: String?, note: String?, removeCopyIds: List<String>): Boolean {
        checkEdit(priceCents, externalUrl)?.let { throw IllegalArgumentException(it) }
        val l = fresh.listings.find { it.listingId == listingId && it.status == "aktiv" } ?: throw IllegalStateException(CHANGED)
        val live = fresh.liveItemsOf(listingId).map { it.copyId }
        val ops = updateOps(l, priceCents, title, description, externalUrl, note, removeCopyIds, live)
        run(ops)
        return ops.any { it.body == ENDED }
    }

    /** "Karte fehlt" antippen / Position herausnehmen. -> true, wenn das Angebot dabei endete. */
    suspend fun removeItems(fresh: ListingsData, listingId: String, copyIds: List<String>): Boolean {
        if (fresh.listings.none { it.listingId == listingId && it.status == "aktiv" }) throw IllegalStateException(CHANGED)
        val ops = removeOps(listingId, copyIds, fresh.liveItemsOf(listingId).map { it.copyId })
        run(ops)
        return ops.any { it.body == ENDED }
    }

    internal fun endOps(listingId: String): List<Op> = listOf(Op("PATCH", "listings", activeFilter(listingId), ENDED))
    suspend fun end(listingId: String) = run(endOps(listingId))

    /**
     * Spec §7.1/§7.2 -- nach erfolgreichem book_sale: das Angebot, aus dem verkauft wurde, verkauft/teilweise verkauft,
     * danach die verkauften Exemplare aus allen ANDEREN aktiven Angeboten nehmen. [data] frisch geladen.
     * Gegenstück: listings.cjs#applySaleToListings (dort in der bookSale-Transaktion).
     */
    internal fun afterBookingOps(data: ListingsData, saleId: String, soldCopyIds: List<String>, fromListingId: String?): Pair<List<Op>, AfterBooking> {
        val ops = ArrayList<Op>()
        var askAdjust = false
        var skipped = false
        if (fromListingId != null) {
            val l = data.listings.find { it.listingId == fromListingId }
            if (l == null || l.status != "aktiv" || l.deleted) {
                skipped = true
            } else {
                val live = data.liveItemsOf(l.listingId).map { it.copyId }
                val r = ListingText.afterListingSale(l.channelId, l.status, l.priceCents, live, soldCopyIds)
                if (r.status == "verkauft") {
                    ops += Op("PATCH", "listings", activeFilter(l.listingId), JSONObject().put("status", "verkauft").put("sale_id", saleId).toString())
                } else {
                    if (r.removeCopyIds.isNotEmpty()) ops += Op("PATCH", "listing_items", itemsFilter(l.listingId, r.removeCopyIds), DELETED)
                    if (r.priceCents != l.priceCents) ops += Op("PATCH", "listings", activeFilter(l.listingId), JSONObject().put("price", r.priceCents / 100.0).toString())
                }
                askAdjust = r.askAdjust
            }
        }
        val c = ListingText.cleanupAfterSale(data.heads(), data.lineItems(), soldCopyIds, if (skipped) null else fromListingId)
        for ((lid, list) in c.removeItems.groupBy { it.listingId }) ops += Op("PATCH", "listing_items", itemsFilter(lid, list.map { it.copyId }), DELETED)
        for (lid in c.endListings) ops += Op("PATCH", "listings", activeFilter(lid), ENDED)
        return ops to AfterBooking(c.remind, askAdjust, skipped)
    }

    suspend fun afterBooking(data: ListingsData, saleId: String, soldCopyIds: List<String>, fromListingId: String?): AfterBooking {
        val (ops, r) = afterBookingOps(data, saleId, soldCopyIds, fromListingId)
        run(ops)
        return r
    }

    private suspend fun run(ops: List<Op>) = withContext(Dispatchers.IO) {
        for (op in ops) {
            executeWithReauth {
                val b = base(url(op.table, op.params)).addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", if (op.expectRow) "return=representation" else "return=minimal")
                val body = op.body.toRequestBody(SupabaseCloud.jsonMedia)
                (if (op.method == "POST") b.post(body) else b.patch(body)).build()
            }.use { r ->
                val text = r.body?.string()
                if (!r.isSuccessful) throw RuntimeException(SalesRepository.dbErrorMessage(text, r.code))
                if (op.expectRow && (text.isNullOrBlank() || JSONArray(text).length() == 0)) throw IllegalStateException(CHANGED)
            }
        }
    }

    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(table: String, params: List<Pair<String, String>>, what: String): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${r.code}): $text")
            text
        }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    // Bei 401 (Token nach ~1 h abgelaufen) einmal neu anmelden und wiederholen.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
