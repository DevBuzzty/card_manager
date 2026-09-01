package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

data class DealWatch(
    val id: Long, val query: String, val maxPrice: Double,
    val active: Boolean, val condition: String = "any",
)
data class DealAlert(
    val id: Long, val watchId: Long, val source: String, val title: String,
    val price: Double?, val url: String, val imageUrl: String?, val foundAt: String,
)

// Reads/writes the Supabase deal_watches / deal_alerts tables over REST, so the phone's
// Deals tab works without the desktop. Mirrors CollectionRepository's auth/reauth pattern.
object DealsRepository {

    suspend fun loadAlerts(): List<DealAlert> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deal_alerts".toHttpUrl().newBuilder()
            .addQueryParameter("select", "*")
            .addQueryParameter("dismissed", "eq.false")
            .addQueryParameter("order", "found_at.desc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseAlert(arr.getJSONObject(it)) } }
    }

    suspend fun loadWatches(): List<DealWatch> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deal_watches".toHttpUrl().newBuilder()
            .addQueryParameter("select", "*")
            .addQueryParameter("order", "created_at.desc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseWatch(arr.getJSONObject(it)) } }
    }

    suspend fun addWatch(query: String, maxPrice: Double, condition: String = "any") = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("query", query).put("max_price", maxPrice).put("condition", condition).toString()
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/deal_watches".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Watch anlegen", r) }
    }

    suspend fun deleteWatch(id: Long) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deal_watches".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$id").build()
        executeWithReauth { base(url).delete().build() }
            .use { r -> if (!r.isSuccessful) err("Watch löschen", r) }
    }

    suspend fun dismissAlert(id: Long) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deal_alerts".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$id").build()
        val body = JSONObject().put("dismissed", true).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Deal ausblenden", r) }
    }

    // Fire an immediate cloud scrape so opening the tab / adding a watch gives fresh results.
    // Best-effort: the cron runs it anyway, so failures here are non-fatal.
    suspend fun triggerScrape() = withContext(Dispatchers.IO) {
        try {
            executeWithReauth {
                base("${SupabaseCloud.base()}/functions/v1/scrape-deals".toHttpUrl())
                    .post("".toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.close()
        } catch (_: Exception) { /* non-fatal */ }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private suspend fun getArray(url: HttpUrl): JSONArray = withContext(Dispatchers.IO) {
        executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Laden fehlgeschlagen (${r.code}): $text")
            JSONArray(text)
        }
    }

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // On a 401 (expired ~1h token) re-auth once and retry.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }

    private fun parseAlert(o: JSONObject) = DealAlert(
        id = o.optLong("id"), watchId = o.optLong("watch_id"),
        source = o.optString("source"), title = o.optString("title"),
        price = if (o.isNull("price")) null else o.optDouble("price"),
        url = o.optString("url"),
        imageUrl = if (o.isNull("image_url")) null else o.optString("image_url"),
        foundAt = o.optString("found_at"),
    )

    private fun parseWatch(o: JSONObject) = DealWatch(
        id = o.optLong("id"), query = o.optString("query"),
        maxPrice = o.optDouble("max_price"), active = o.optBoolean("active", true),
        condition = o.optString("condition", "any"),
    )
}
