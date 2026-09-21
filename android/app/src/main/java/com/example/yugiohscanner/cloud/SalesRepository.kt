package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.SalesMath
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

/** Zeile aus sales + ihre Notiz (SalesMath.SaleHead selbst kennt keine Notiz -- Zwilling mit sales-math.cjs/saleMath.js). */
internal data class ParsedSale(val head: SalesMath.SaleHead, val note: String?, val createdAt: String? = null)

/**
 * Spec H2 §4.2/§8 -- Verkaeufe ueber REST (supabase/sales_schema.sql) plus die Cloud-Funktionen
 * book_sale/update_sale/cancel_sale fuer die Schreibvorgaenge, die mehrere Tabellen anfassen.
 * Bauart wie SealedRepository (Auth-Kopf, executeWithReauth bei 401). Kleine Liste, voll neu
 * geladen (SideStores.sales), kein updated_at-Delta.
 *
 * PostgREST kann `numeric`-Spalten als Zahl ODER als Text liefern -- [num] faengt beides ab.
 */
object SalesRepository {
    private fun num(o: JSONObject, k: String): Double? {
        if (o.isNull(k)) return null
        return when (val v = o.get(k)) {
            is Number -> v.toDouble()
            is String -> v.toDouble()
            else -> null
        }
    }

    internal fun parseSales(text: String): List<ParsedSale> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            ParsedSale(
                head = SalesMath.SaleHead(
                    saleId = o.getString("sale_id"),
                    soldOn = o.getString("sold_on"),
                    channelId = o.getString("channel_id"),
                    channelName = o.getString("channel_name"),
                    gross = num(o, "gross") ?: 0.0,
                    fees = num(o, "fees"),
                    shipping = num(o, "shipping"),
                    status = o.getString("status"),
                    deleted = o.optBoolean("deleted", false),
                ),
                note = if (o.isNull("note")) null else o.getString("note"),
                createdAt = if (!o.has("created_at") || o.isNull("created_at")) null else o.getString("created_at"),
            )
        }
    }

    internal fun parseItems(text: String): List<SaleItemRow> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SaleItemRow(
                saleId = o.getString("sale_id"),
                copyId = o.getString("copy_id"),
                valueAtSale = num(o, "value_at_sale") ?: 0.0,
                share = num(o, "share") ?: 0.0,
                wasForSale = o.optBoolean("was_for_sale", false),
                cardId = o.getString("card_id"),
                setCode = o.getString("set_code"),
                language = o.getString("language"),
                rarity = o.getString("rarity"),
                edition = o.getString("edition"),
                condition = o.getString("condition"),
                name = if (o.isNull("name")) null else o.getString("name"),
                imageUrl = if (o.isNull("image_url")) null else o.getString("image_url"),
                deleted = o.optBoolean("deleted", false),
            )
        }
    }

    internal fun parseChannels(text: String): List<SaleChannel> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SaleChannel(
                channelId = o.getString("channel_id"),
                name = o.getString("name"),
                feePercent = num(o, "fee_percent") ?: 0.0,
                builtin = o.optBoolean("builtin", false),
                sort = o.optInt("sort", 100),
            )
        }
    }

    private fun parseSoldInRows(text: String): List<Pair<String, String?>> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            o.getString("copy_id") to (if (o.isNull("sold_in")) null else o.getString("sold_in"))
        }
    }

    // Supabase deckelt `limit` bei 1000 Zeilen (PostgREST max-rows), egal was angefragt wird -- sales,
    // sale_items und die sold_in-Zeilen von card_copies koennen das mit der Zeit ueberschreiten und
    // wuerden dann still abgeschnitten (soldIn faelschlich null -> Positionen zaehlen nicht mehr mit).
    // Darum ueber KeysetPager blaettern, mit derselben Bauart wie StoreQueries/Keyset. Fuer `sales` wird
    // dabei nach der eindeutigen sale_id aufsteigend geblaettert (statt nach sold_on/created_at absteigend
    // mit Gleichstaenden) und danach in load() fuer die Anzeige umsortiert -- einfacher als absteigendes
    // Keyset-Blaettern ueber mehrere Spalten. sale_channels bleibt eine kleine, eingebaute Liste ohne Blaettern.
    internal fun salesPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf(
            "select" to "sale_id,sold_on,channel_id,channel_name,gross,fees,shipping,status,note,created_at,deleted",
            "deleted" to "eq.false",
            "order" to "sale_id.asc",
            "limit" to StoreQueries.PAGE.toString(),
        )
        if (after != null) p += "or" to Keyset.after(listOf("sale_id"), listOf(after))
        return p
    }

    internal fun itemsPageParams(after: SaleItemRow?): List<Pair<String, String>> {
        val p = arrayListOf(
            "select" to "*",
            "order" to "sale_id.asc,copy_id.asc",
            "limit" to StoreQueries.PAGE.toString(),
        )
        if (after != null) p += "or" to Keyset.after(listOf("sale_id", "copy_id"), listOf(after.saleId, after.copyId))
        return p
    }

    internal fun soldInPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf(
            "select" to "copy_id,sold_in",
            "sold_in" to "not.is.null",
            "order" to "copy_id.asc",
            "limit" to StoreQueries.PAGE.toString(),
        )
        if (after != null) p += "or" to Keyset.after(listOf("copy_id"), listOf(after))
        return p
    }

    /**
     * Anzeige-Reihenfolge wie am PC (sales.cjs#salesOverview: `ORDER BY sold_on DESC, created_at DESC, sale_id`):
     * neuestes Datum zuerst, am selben Tag der zuletzt angelegte zuerst, dann sale_id aufsteigend.
     * created_at kommt von PostgREST in einheitlichem ISO-Format, daher genuegt der Textvergleich; fehlt es, steht
     * die Zeile am Ende ihres Tages (wie NULL bei DESC in SQLite).
     */
    internal fun displayOrder(parsed: List<ParsedSale>): List<ParsedSale> =
        parsed.sortedWith(
            compareByDescending<ParsedSale> { it.head.soldOn }
                .thenByDescending { it.createdAt ?: "" }
                .thenBy { it.head.saleId },
        )

    suspend fun load(): SalesData {
        val parsed = KeysetPager.all(StoreQueries.PAGE) { after: ParsedSale? ->
            parseSales(getText("sales", salesPageParams(after?.head?.saleId), "Verkäufe laden"))
        }
        val items = KeysetPager.all(StoreQueries.PAGE) { after: SaleItemRow? ->
            parseItems(getText("sale_items", itemsPageParams(after), "Positionen laden"))
        }
        val soldInRows = KeysetPager.all(StoreQueries.PAGE) { after: Pair<String, String?>? ->
            parseSoldInRows(getText("card_copies", soldInPageParams(after?.first), "Exemplare laden"))
        }
        val channelsText = getText(
            "sale_channels",
            listOf(
                "select" to "channel_id,name,fee_percent,builtin,sort", "deleted" to "eq.false",
                "order" to "sort.asc,name.asc", "limit" to StoreQueries.PAGE.toString(),
            ),
            "Kanäle laden",
        )

        // Anzeige-Reihenfolge erst nach dem Blaettern herstellen -- die Anfragen selbst sind nach sale_id
        // sortiert (siehe salesPageParams).
        val sorted = displayOrder(parsed)
        return SalesData(
            sales = sorted.map { it.head },
            notes = sorted.associate { it.head.saleId to it.note },
            items = items,
            soldIn = soldInRows.toMap(),
            channels = parseChannels(channelsText),
        )
    }

    private fun headJson(h: SaleHeadInput): JSONObject = JSONObject()
        .put("sold_on", h.soldOn).put("channel_id", h.channelId).put("channel_name", h.channelName).put("gross", h.gross)
        .put("fees", h.fees ?: JSONObject.NULL).put("shipping", h.shipping ?: JSONObject.NULL)
        .put("note", h.note?.trim()?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)

    /** Reine Nutzlast fuer book_sale. [items]/[shares] muessen bereits nach copyId sortiert sein (Aufrufer: [book]). */
    fun bookBody(saleId: String, head: SaleHeadInput, items: List<Pair<String, Long>>, shares: List<Long>): JSONObject =
        JSONObject().put("p_sale", headJson(head).put("sale_id", saleId))
            .put("p_items", JSONArray().apply {
                items.forEachIndexed { i, (id, v) -> put(JSONObject().put("copy_id", id).put("value_at_sale", v / 100.0).put("share", shares[i] / 100.0)) }
            })

    /** Reine Nutzlast fuer update_sale. [shares] sind bereits (copyId, Anteil in Cent) je verbleibender Position. */
    internal fun updateBody(saleId: String, head: SaleHeadInput, shares: List<Pair<String, Long>>, returned: List<String>): JSONObject =
        JSONObject().put("p_sale", headJson(head).put("sale_id", saleId))
            .put("p_shares", JSONArray().apply {
                shares.forEach { (id, s) -> put(JSONObject().put("copy_id", id).put("share", s / 100.0)) }
            })
            .put("p_returned", JSONArray(returned))

    /**
     * Sortiert [items] nach copyId (String-Ordnung, wie der Desktop-Sort nach copy_id -- Controller-
     * Vorgabe 1) und verteilt darueber den Netto-Erloes von [head] (SalesMath.distribute). Geteilt
     * zwischen [book] und [update], damit ein versehentlich entferntes Sortieren an EINER Stelle beide
     * Aufrufer und ihre Tests bricht, statt sich unbemerkt in einem der beiden einzuschleichen.
     */
    internal fun prepareItems(head: SaleHeadInput, items: List<Pair<String, Long>>): Pair<List<Pair<String, Long>>, List<Long>> {
        val sorted = items.sortedBy { it.first }
        val shares = SalesMath.distribute(SalesMath.netCents(head.gross, head.fees, head.shipping), sorted.map { it.second })
        return sorted to shares
    }

    /**
     * Bucht einen neuen Verkauf: Anteile ueber [prepareItems] (sortiert nach copyId, dann verteilt) --
     * die sortierte Reihenfolge steht danach auch in der Nutzlast. Gibt die neue sale_id zurueck.
     */
    suspend fun book(head: SaleHeadInput, items: List<Pair<String, Long>>): String {
        val (sorted, shares) = prepareItems(head, items)
        val saleId = UUID.randomUUID().toString()
        rpc("book_sale", bookBody(saleId, head, sorted, shares))
        return saleId
    }

    /**
     * Aendert Kopf, Anteile und Rueckgaben eines aktiven Verkaufs. [remaining] sind ALLE nicht
     * zurueckgegebenen, lebenden Positionen -- update_sale setzt share nur fuer Zeilen aus p_shares, darum
     * muss [remaining] wirklich jede verbleibende Position enthalten, sonst behaelt sie ihren alten Anteil.
     * [remaining] wird ueber [prepareItems] wie [book] nach copyId sortiert, bevor verteilt wird.
     * [head.channelName] ist eine Momentaufnahme: bleibt der Kanal unveraendert, uebergibt die Oberflaeche
     * den am Verkauf gespeicherten Namen unveraendert weiter (kein Nachschlagen ueber channelId).
     */
    suspend fun update(saleId: String, head: SaleHeadInput, remaining: List<Pair<String, Long>>, returned: List<String>) {
        val (sorted, shareCents) = prepareItems(head, remaining)
        val shares = sorted.mapIndexed { i, (id, _) -> id to shareCents[i] }
        rpc("update_sale", updateBody(saleId, head, shares, returned))
    }

    suspend fun cancel(saleId: String) {
        rpc("cancel_sale", JSONObject().put("p_sale_id", saleId))
    }

    /** Legt einen Kanal an ([channelId] null) oder aendert ihn. Gibt die channel_id zurueck (neu vergeben oder [channelId]). */
    suspend fun saveChannel(channelId: String?, name: String, feePercent: Double): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("Der Kanal braucht einen Namen.")
        if (feePercent.isNaN() || feePercent < 0 || feePercent > 100) throw IllegalArgumentException("Die Gebühr muss zwischen 0 und 100 % liegen.")
        if (channelId == null) {
            val id = UUID.randomUUID().toString()
            val body = JSONObject().put("channel_id", id).put("name", trimmed).put("fee_percent", feePercent)
            post("sale_channels", body, "Kanal speichern")
            return id
        } else {
            val body = JSONObject().put("name", trimmed).put("fee_percent", feePercent)
            patch("sale_channels", listOf("channel_id" to "eq.$channelId", "deleted" to "eq.false"), body, "Kanal speichern")
            return channelId
        }
    }

    suspend fun hideChannel(id: String) {
        patch("sale_channels", listOf("channel_id" to "eq.$id", "builtin" to "eq.false"), JSONObject().put("deleted", true), "Kanal ausblenden")
    }

    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private fun rpcUrl(name: String): HttpUrl = "${SupabaseCloud.base()}/rest/v1/rpc/$name".toHttpUrl()

    private suspend fun getText(table: String, params: List<Pair<String, String>>, what: String): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${r.code}): $text")
            text
        }
    }

    private suspend fun patch(table: String, params: List<Pair<String, String>>, body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(table, params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private suspend fun post(table: String, body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(table, emptyList())).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    /** book_sale/update_sale/cancel_sale: die DB-Fehlermeldung (message im JSON, sonst der Rohtext) unveraendert weiterreichen. */
    private suspend fun rpc(name: String, body: JSONObject) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(rpcUrl(name)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) throw dbError(r) }
    }

    /** Reine Nachrichtenwahl fuer [dbError]: message aus dem PostgREST-Fehler-JSON, sonst der Rohtext, sonst -- bei leerem Rumpf -- ein Standardtext. */
    internal fun dbErrorMessage(body: String?, code: Int): String {
        val text = body?.takeIf { it.isNotBlank() } ?: return "Cloud-Aufruf fehlgeschlagen ($code)"
        return runCatching { JSONObject(text).optString("message") }.getOrNull()?.takeIf { it.isNotEmpty() } ?: text
    }

    private fun dbError(r: Response): RuntimeException = RuntimeException(dbErrorMessage(r.body?.string(), r.code))

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // Bei 401 (Token nach ~1 h abgelaufen) einmal neu anmelden und wiederholen.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
