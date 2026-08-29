package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class SetOption(val setCode: String, val rarity: String, val price: Double)

// Looks up the printings (card_sets) of a passcode from YGOPRODeck. Independent of Supabase.
object PrintingRepository {
    private val client = OkHttpClient()

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
                out.add(SetOption(code, rarity, price))
            }
            out
        }
    }
}
