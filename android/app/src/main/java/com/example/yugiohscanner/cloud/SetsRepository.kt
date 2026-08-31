package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray

// One Yu-Gi-Oh set from YGOPRODeck's public `cardsets.php` list.
data class SetInfo(val code: String, val name: String, val total: Int)

// Loads the full set catalog from YGOPRODeck (public, no auth). Reuses the shared
// OkHttp client from SupabaseCloud; no Supabase headers needed for this upstream.
object SetsRepository {

    suspend fun loadSets(): Map<String, SetInfo> = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://db.ygoprodeck.com/api/v7/cardsets.php")
            .get()
            .build()
        SupabaseCloud.http().newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Sets laden fehlgeschlagen (${resp.code}): $text")
            parse(JSONArray(text))
        }
    }

    private fun parse(arr: JSONArray): Map<String, SetInfo> {
        val out = LinkedHashMap<String, SetInfo>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val code = o.optString("set_code", "").trim()
            val total = o.optInt("num_of_cards", 0)
            if (code.isBlank() || total <= 0) continue
            out[code.uppercase()] = SetInfo(
                code = code.uppercase(),
                name = decode(o.optString("set_name", code)),
                total = total,
            )
        }
        return out
    }

    // YGOPRODeck set names come HTML-escaped (e.g. "5D&apos;s").
    private fun decode(s: String): String = s
        .replace("&apos;", "'").replace("&#39;", "'").replace("&quot;", "\"")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
}
