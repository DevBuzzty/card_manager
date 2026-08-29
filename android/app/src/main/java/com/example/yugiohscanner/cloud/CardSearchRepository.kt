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
        val isPasscode = q.all { it.isDigit() }
        val url = "https://db.ygoprodeck.com/api/v7/cardinfo.php".toHttpUrl().newBuilder()
            .addQueryParameter(if (isPasscode) "id" else "fname", q)
            .build()
        val req = Request.Builder().url(url).get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            // YGOPRODeck returns {"error": "..."} (HTTP 400) for no matches — treat as empty.
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
