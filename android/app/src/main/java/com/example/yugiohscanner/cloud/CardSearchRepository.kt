package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

// Searches YGOPRODeck for cards by name or passcode. Independent of Supabase.
object CardSearchRepository {
    private val client = OkHttpClient()

    suspend fun search(query: String): List<CardRow> = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isEmpty()) return@withContext emptyList()
        // Passcode: one lookup, in German (returns the German name too).
        if (q.all { it.isDigit() }) return@withContext fetch("id", q, german = true)
        // Name: the collection is mostly German, so search the German DB first, then the
        // English DB as a fallback (YGOPRODeck's language=de only matches German names).
        // Merge by id, keeping the German-named hit when a card matches in both.
        val de = fetch("fname", q, german = true)
        val en = fetch("fname", q, german = false)
        val seen = HashSet<String>()
        val out = ArrayList<CardRow>(de.size + en.size)
        for (c in de) if (seen.add(c.id)) out.add(c)
        for (c in en) if (seen.add(c.id)) out.add(c)
        out
    }

    // One YGOPRODeck query. `german=true` adds language=de so names/descriptions come back
    // in German. Returns [] on the {"error": ...} no-match response (HTTP 400).
    private suspend fun fetch(paramKey: String, value: String, german: Boolean): List<CardRow> = withContext(Dispatchers.IO) {
        val builder = "https://db.ygoprodeck.com/api/v7/cardinfo.php".toHttpUrl().newBuilder()
            .addQueryParameter(paramKey, value)
        if (german) builder.addQueryParameter("language", "de")
        val req = Request.Builder().url(builder.build()).get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            val data = JSONObject(text).optJSONArray("data") ?: return@withContext emptyList()
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
            out
        }
    }
}
