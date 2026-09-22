package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Spec H3b1 §5.1 -- Zeile aus ebay_listings (nur die Funktion schreibt, das Handy liest). */
data class EbayListingRow(
    val listingId: String, val environment: String, val state: String, val itemUrl: String?, val error: String?,
    val publishedQty: Int?,
) {
    fun row(): EbayMarks.Row = EbayMarks.Row(environment, state, itemUrl, error)
}

/** Spec H3b1 §6 -- eigenes Foto (Strom wie listings, weiches Löschen). */
data class ListingPhoto(val photoId: String, val listingId: String, val path: String, val sort: Int, val deleted: Boolean)

/**
 * Spec H3b1 -- eBay am Handy über REST (supabase/ebay_schema.sql) und die Funktionen ebay-auth/ebay-sync. Bauart wie
 * ListingsRepository (Auth-Kopf, bei 401 einmal neu anmelden, Blättern per KeysetPager über 1000 Zeilen).
 * Die Geräte sehen nie Tokens: gelesen wird nur ebay_status, geschrieben nur listing_photos und Speicher-Dateien.
 */
object EbayRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jpeg = "image/jpeg".toMediaType()
    private const val ROW_COLS = "listing_id,environment,state,item_url,error,published_qty"
    private const val PHOTO_COLS = "photo_id,listing_id,path,sort,deleted"
    // Ein Durchgang von ebay-sync dauert länger als OkHttps 10 s Standard (bis zu 50 Angebote).
    private val slow by lazy { SupabaseCloud.http().newBuilder().readTimeout(150, TimeUnit.SECONDS).callTimeout(160, TimeUnit.SECONDS).build() }

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    internal fun parseStatus(text: String): EbayMarks.Status? {
        val a = JSONArray(text)
        if (a.length() == 0) return null
        val o = a.getJSONObject(0)
        return EbayMarks.Status(
            o.getString("environment"), o.optBoolean("connected", false), str(o, "refresh_expires_at"),
            o.optBoolean("has_payment_policy", false), str(o, "payment_policy_name"),
            o.optBoolean("has_fulfillment_policy", false), str(o, "fulfillment_policy_name"),
            o.optBoolean("has_return_policy", false), str(o, "return_policy_name"),
            o.optBoolean("has_location", false), str(o, "location_key"),
        )
    }
    /** Letzter Lauf/Fehler aus derselben Zeile (für die Einstellungen). */
    data class RunInfo(val lastRunAt: String?, val summary: String?, val lastError: String?)
    internal fun parseRunInfo(text: String): RunInfo? {
        val a = JSONArray(text)
        if (a.length() == 0) return null
        val o = a.getJSONObject(0)
        return RunInfo(str(o, "last_run_at"), str(o, "last_run_summary"), str(o, "last_error"))
    }
    internal fun parseRows(text: String): List<EbayListingRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            EbayListingRow(o.getString("listing_id"), o.getString("environment"), o.getString("state"), str(o, "item_url"),
                str(o, "error"), if (o.isNull("published_qty")) null else o.getInt("published_qty"))
        }
    }
    internal fun parsePhotos(text: String): List<ListingPhoto> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingPhoto(o.getString("photo_id"), o.getString("listing_id"), o.getString("path"), o.optInt("sort", 0), o.optBoolean("deleted", false))
        }
    }

    internal fun rowsPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to ROW_COLS, "order" to "listing_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id"), listOf(after))
        return p
    }
    internal fun photosPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to PHOTO_COLS, "deleted" to "eq.false", "order" to "photo_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("photo_id"), listOf(after))
        return p
    }

    /** Je Angebot die eigenen Fotos in Reihenfolge (sort, dann photo_id) -- wie ebay-map.ts#ownPhotos. */
    fun photosOf(all: List<ListingPhoto>, listingId: String): List<ListingPhoto> =
        all.filter { it.listingId == listingId && !it.deleted }.sortedWith(compareBy<ListingPhoto> { it.sort }.thenBy { it.photoId })

    /**
     * Neue Reihenfolge -> nur die Fotos, deren sort sich ändert (photo_id to neuer sort). [current] muss bereits
     * per [photosOf] auf die lebenden Fotos genau dieses einen Angebots gefiltert sein -- sonst passt `orderedIds`
     * (nur die Fotos EINES Angebots) nicht zur Menge der Schlüssel in [current] und die Prüfung unten schlägt fehl.
     */
    internal fun reorderPatches(current: List<ListingPhoto>, orderedIds: List<String>): List<Pair<String, Int>> {
        val byId = current.associateBy { it.photoId }
        require(orderedIds.size == current.size && orderedIds.toSet() == byId.keys) { "Fotos wurden inzwischen geändert – bitte neu öffnen." }
        return orderedIds.mapIndexedNotNull { i, id -> if (byId.getValue(id).sort != i) id to i else null }
    }
    internal fun photoInsertBody(photoId: String, listingId: String, path: String, sort: Int): String =
        JSONObject().put("photo_id", photoId).put("listing_id", listingId).put("path", path).put("sort", sort).toString()

    // ---- Lesen ----------------------------------------------------------------------------------------------------

    suspend fun loadStatus(): Pair<EbayMarks.Status, RunInfo>? {
        val text = getText("ebay_status", listOf("select" to "*", "limit" to "1"), "eBay-Stand laden")
        val s = parseStatus(text) ?: return null
        return s to (parseRunInfo(text) ?: RunInfo(null, null, null))
    }
    suspend fun loadRows(): Map<String, EbayListingRow> =
        KeysetPager.all(StoreQueries.PAGE) { after: EbayListingRow? -> parseRows(getText("ebay_listings", rowsPageParams(after?.listingId), "eBay-Angebote laden")) }
            .associateBy { it.listingId }
    suspend fun loadPhotos(): List<ListingPhoto> =
        KeysetPager.all(StoreQueries.PAGE) { after: ListingPhoto? -> parsePhotos(getText("listing_photos", photosPageParams(after?.photoId), "Fotos laden")) }

    // ---- Funktionen -----------------------------------------------------------------------------------------------

    /** POST /functions/v1/<name>; die Funktionen antworten { ok, error?, ... } (auch bei erwarteten Fehlern mit 200). */
    suspend fun invoke(name: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        executeWithReauth(slow) {
            base("${SupabaseCloud.base()}/functions/v1/$name".toHttpUrl()).addHeader("Content-Type", "application/json")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r ->
            val text = r.body?.string().orEmpty()
            val o = runCatching { JSONObject(text) }.getOrNull()
            if (o != null && o.has("ok")) return@use o
            JSONObject().put("ok", false).put("error", "eBay-Funktion nicht erreichbar (${r.code}).")
        }
    }
    suspend fun auth(action: String, extra: JSONObject = JSONObject()): JSONObject = invoke("ebay-auth", extra.put("action", action))

    /** „Jetzt abgleichen“/„Erneut versuchen“: wartet auf den Durchgang und lädt danach den eBay-Stand neu. */
    suspend fun syncNow(retryListingId: String? = null): JSONObject {
        val r = invoke("ebay-sync", JSONObject().apply { if (retryListingId != null) put("retry", retryListingId) })
        SideStores.ebayStatus.refreshAndWait()
        SideStores.ebayRows.refreshAndWait()
        return r
    }

    /** Spec §5.4: nach jeder eBay-relevanten Änderung anstoßen -- nur wenn verbunden, ohne zu warten, nie werfend. */
    fun kick() {
        if (SideStores.ebayStatus.state.value.value?.firstOrNull()?.first?.connected != true) return
        scope.launch { runCatching { syncNow() } }
    }

    // ---- Fotos ----------------------------------------------------------------------------------------------------

    /** Lädt [jpegBytes] nach listing-photos/<listing_id>/<uuid>.jpg und legt die Zeile an (sort = hinten). */
    suspend fun addPhoto(listingId: String, jpegBytes: ByteArray, nextSort: Int): ListingPhoto = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString()
        val path = PhotoScale.photoPath(listingId, id)
        executeWithReauth {
            base("${SupabaseCloud.base()}/storage/v1/object/${PhotoScale.BUCKET}/$path".toHttpUrl())
                .addHeader("x-upsert", "false").post(jpegBytes.toRequestBody(jpeg)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException("Foto hochladen fehlgeschlagen (${r.code}): ${r.body?.string().orEmpty()}") }
        write("POST", "listing_photos", emptyList(), photoInsertBody(id, listingId, path, nextSort))
        ListingPhoto(id, listingId, path, nextSort, false)
    }
    suspend fun deletePhoto(photoId: String) =
        write("PATCH", "listing_photos", listOf("photo_id" to "eq.$photoId", "deleted" to "eq.false"), JSONObject().put("deleted", true).toString())
    suspend fun reorder(current: List<ListingPhoto>, orderedIds: List<String>) {
        for ((id, sort) in reorderPatches(current, orderedIds)) {
            write("PATCH", "listing_photos", listOf("photo_id" to "eq.$id"), JSONObject().put("sort", sort).toString())
        }
    }

    // ---- HTTP -----------------------------------------------------------------------------------------------------

    private suspend fun write(method: String, table: String, params: List<Pair<String, String>>, body: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            val b = base(url(table, params)).addHeader("Content-Type", "application/json").addHeader("Prefer", "return=minimal")
            val rb = body.toRequestBody(SupabaseCloud.jsonMedia)
            (if (method == "POST") b.post(rb) else b.patch(rb)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(SalesRepository.dbErrorMessage(r.body?.string(), r.code)) }
    }
    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
    private suspend fun getText(table: String, params: List<Pair<String, String>>, what: String): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${r.code}): $text")
            text
        }
    }
    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
    private suspend fun executeWithReauth(client: okhttp3.OkHttpClient = SupabaseCloud.http(), build: () -> Request): Response =
        withContext(Dispatchers.IO) {
            val first = client.newCall(build()).execute()
            if (first.code != 401) return@withContext first
            first.close()
            SupabaseCloud.signIn()
            client.newCall(build()).execute()
        }
}
