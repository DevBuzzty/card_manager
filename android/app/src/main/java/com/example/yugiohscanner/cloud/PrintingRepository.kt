package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder

data class SetOption(val setCode: String, val rarity: String, val price: Double, val language: String = "EN")

// Looks up the printings (card_sets) of a passcode. Independent of Supabase.
// English/international printings come from YGOPRODeck; German printings come from Yugipedia
// (YGOPRODeck's language=de does NOT return -DE- set codes), matching the desktop app.
object PrintingRepository {
    private val client = OkHttpClient()
    private const val UA = "YGOScanner/1.0 (card collection app)"

    // German printings first (the collection is German-first), then English as fallback.
    suspend fun fetchAllSets(passcode: String): List<SetOption> = withContext(Dispatchers.IO) {
        val de = runCatching { fetchGermanSets(passcode) }.getOrDefault(emptyList())
        val en = runCatching { fetchSets(passcode) }.getOrDefault(emptyList())
        val seen = HashSet<String>()
        val out = ArrayList<SetOption>(de.size + en.size)
        for (s in de + en) if (seen.add("${s.setCode}|${s.rarity}")) out.add(s)
        out
    }

    // English/international printings from YGOPRODeck.
    suspend fun fetchSets(passcode: String): List<SetOption> = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://db.ygoprodeck.com/api/v7/cardinfo.php?id=$passcode")
            .get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("YGOPRODeck (${resp.code})")
            val data = JSONObject(text).optJSONArray("data") ?: return@withContext emptyList()
            if (data.length() == 0) return@withContext emptyList()
            val sets = data.getJSONObject(0).optJSONArray("card_sets") ?: return@withContext emptyList()
            val seen = HashSet<String>()
            val out = ArrayList<SetOption>()
            for (i in 0 until sets.length()) {
                val s = sets.getJSONObject(i)
                val code = s.optString("set_code", "")
                val rarity = s.optString("set_rarity", "")
                if (code.isBlank()) continue
                if (!seen.add(code)) continue
                val price = s.optString("set_price", "0").toDoubleOrNull() ?: 0.0
                out.add(SetOption(code, rarity, price, "EN"))
            }
            out
        }
    }

    // German printings from Yugipedia: resolve passcode -> page title, fetch wikitext, parse the
    // `de_sets` block (lines "SET-CODE; Set Name; Rarity[,Rarity]"). No price available -> 0.0.
    suspend fun fetchGermanSets(passcode: String): List<SetOption> = withContext(Dispatchers.IO) {
        // 1) passcode -> page title
        val titleReq = Request.Builder()
            .url("https://yugipedia.com/api.php?action=query&titles=$passcode&redirects&format=json")
            .header("User-Agent", UA).get().build()
        val title = client.newCall(titleReq).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext emptyList()
            val pages = JSONObject(resp.body?.string() ?: "")
                .optJSONObject("query")?.optJSONObject("pages") ?: return@withContext emptyList()
            val keys = pages.keys()
            if (!keys.hasNext()) return@withContext emptyList()
            val key: String = keys.next().toString()
            if (key == "-1") return@withContext emptyList()
            pages.getJSONObject(key).optString("title", "")
        }
        if (title.isBlank()) return@withContext emptyList()

        // 2) wikitext
        val parseReq = Request.Builder()
            .url("https://yugipedia.com/api.php?action=parse&page=${URLEncoder.encode(title, "UTF-8")}&prop=wikitext&format=json")
            .header("User-Agent", UA).get().build()
        val wikitext = client.newCall(parseReq).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext emptyList()
            JSONObject(resp.body?.string() ?: "")
                .optJSONObject("parse")?.optJSONObject("wikitext")?.optString("*", "")
                ?: return@withContext emptyList()
        }

        // 3) parse the de_sets block
        val block = Regex("""\|\s*de_sets\s*=\s*([\s\S]*?)\n\s*\|""").find(wikitext)
            ?: return@withContext emptyList()
        val out = ArrayList<SetOption>()
        for (line in block.groupValues[1].split("\n")) {
            val parts = line.trim().split(";")
            if (parts.size < 3) continue
            val code = parts[0].trim()
            if (code.isEmpty()) continue
            for (rarity in parts[2].split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
                out.add(SetOption(code, rarity, 0.0, "DE"))
            }
        }
        out
    }
}
