package com.example.yugiohscanner.cloud

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

// Searches YGOPRODeck for cards by name or passcode. Independent of Supabase.
object CardSearchRepository {
    // Bounded timeouts so a slow/hung German lookup can't stall the whole staging resolution.
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun search(query: String): List<CardRow> = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isEmpty()) return@withContext emptyList()
        // Passcode: German DB first (for the German name), but fall back to English — many cards
        // (e.g. never released in German) exist ONLY in the English DB and would otherwise 404.
        // The German lookup is RETRIED on transient failure (see fetchRetry): a rate-limited or
        // timed-out language=de request used to be indistinguishable from a genuine "no German
        // printing" and silently degraded to the English name, which is why a card with a German
        // name kept showing up in English until several re-scans.
        if (q.all { it.isDigit() }) {
            val de = fetchRetry("id", q, german = true)
            return@withContext de.ifEmpty { fetchRetry("id", q, german = false) }
        }
        // Name: the collection is mostly German, so search the German DB first, then the
        // English DB as a fallback (YGOPRODeck's language=de only matches German names).
        // Merge by id, keeping the German-named hit when a card matches in both.
        val de = fetchRetry("fname", q, german = true)
        val en = fetchRetry("fname", q, german = false)
        val seen = HashSet<String>()
        val out = ArrayList<CardRow>(de.size + en.size)
        for (c in de) if (seen.add(c.id)) out.add(c)
        for (c in en) if (seen.add(c.id)) out.add(c)
        out
    }

    // A YGOPRODeck query with retry. Only TRANSIENT failures (network error / rate limit — a null
    // from fetchOrNull) are retried with backoff; a definitive answer (real data OR a genuine
    // no-match, both non-null) returns at once, so cards with no German release aren't slowed down.
    private suspend fun fetchRetry(paramKey: String, value: String, german: Boolean, attempts: Int = 3): List<CardRow> {
        repeat(attempts) { i ->
            val r = fetchOrNull(paramKey, value, german)
            if (r != null) return r
            Log.w("CardSearch", "YGOPRODeck ${if (german) "de" else "en"} lookup failed for $paramKey=$value (try ${i + 1}/$attempts)")
            if (i < attempts - 1) delay(350L * (i + 1))
        }
        return emptyList()
    }

    // One YGOPRODeck query. `german=true` adds language=de so names/descriptions come back in
    // German. Returns a list (empty on a genuine no-match) OR null on a transient/retryable
    // failure — a network/timeout error, an HTTP 429, or a 400 whose body mentions rate limiting.
    // Passcode (id) lookups are cached per (id, language) on disk — they're the scan path and are
    // deterministic; name (fname) searches are not cached (free-text, low reuse).
    private suspend fun fetchOrNull(paramKey: String, value: String, german: Boolean): List<CardRow>? = withContext(Dispatchers.IO) {
        val cacheable = paramKey == "id"
        val cacheKey = "${value}_${if (german) "de" else "en"}"
        if (cacheable) {
            ScanCache.read("card", cacheKey)?.let { cached ->
                runCatching { parseData(cached) }.getOrNull()?.let { return@withContext it }
            }
        }
        val builder = "https://db.ygoprodeck.com/api/v7/cardinfo.php".toHttpUrl().newBuilder()
            .addQueryParameter(paramKey, value)
        if (german) builder.addQueryParameter("language", "de")
        val req = Request.Builder().url(builder.build()).get().build()
        try {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                if (resp.isSuccessful) {
                    val data = JSONObject(text).optJSONArray("data")
                    if (data == null || data.length() == 0) return@withContext emptyList()
                    // Real, non-empty response — safe to cache the raw body and re-parse it next time.
                    if (cacheable) ScanCache.write("card", cacheKey, text)
                    return@withContext parseData(text)
                }
                // Non-2xx. YGOPRODeck answers a genuine no-match with HTTP 400 (don't retry), and a
                // rate-limited burst with a 429 or a 400 whose error mentions "rate" (retry those).
                val rateLimited = resp.code == 429 || text.contains("rate", ignoreCase = true)
                return@withContext if (rateLimited) null else emptyList()
            }
        } catch (e: IOException) {
            return@withContext null   // network / timeout — transient, let fetchRetry retry
        }
    }

    // Parse a YGOPRODeck cardinfo response body into CardRows.
    private fun parseData(text: String): List<CardRow> {
        val data = JSONObject(text).optJSONArray("data") ?: return emptyList()
        val out = ArrayList<CardRow>(data.length())
            for (i in 0 until data.length()) {
                val c = data.getJSONObject(i)
                val images = c.optJSONArray("card_images")
                val imageUrl = if (images != null && images.length() > 0)
                    images.getJSONObject(0).optString("image_url", "").ifBlank { null } else null
                val type = c.optString("type", "").ifBlank { null }
                val level = if (type?.contains("Link") == true) {
                    if (c.isNull("linkval")) null else c.optInt("linkval")
                } else if (c.isNull("level")) null else c.optInt("level")
                out.add(
                    CardRow(
                        id = c.get("id").toString(),
                        setCode = "Unknown",
                        language = "DE",
                        name = c.optString("name", "").ifBlank { null },
                        imageUrl = imageUrl,
                        rarity = null,
                        quantity = 0,
                        price = null,
                        type = type,
                        desc = c.optString("desc", "").ifBlank { null },
                        atk = if (c.isNull("atk")) null else c.optInt("atk"),
                        def = if (c.isNull("def")) null else c.optInt("def"),
                        level = level,
                        race = c.optString("race", "").ifBlank { null },
                        attribute = c.optString("attribute", "").ifBlank { null },
                    )
                )
            }
        return out
    }
}
