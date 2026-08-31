package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

// Reads and mutates the Supabase `cards` table over REST. The phone only ever reads,
// changes quantity, or soft-deletes existing rows — it never inserts new cards.
object CollectionRepository {

    suspend fun loadCards(): List<CardRow> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/cards".toHttpUrl().newBuilder()
            .addQueryParameter("select", "*")
            .addQueryParameter("deleted", "eq.false")
            .addQueryParameter("quantity", "gt.0")
            .build()
        executeWithReauth {
            Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseCloud.key())
                .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
                .get()
                .build()
        }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Laden fehlgeschlagen (${resp.code}): $text")
            parse(JSONArray(text))
        }
    }

    suspend fun setQuantity(row: CardRow, qty: Int) =
        patch(row, JSONObject().put("quantity", qty))

    suspend fun softDelete(row: CardRow) =
        patch(row, JSONObject().put("deleted", true))

    // Creates a new printing row in the cloud, reusing the base card's shared detail fields.
    // Only for a printing the user does NOT already own (the picker excludes owned ones).
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", "DE")
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("quantity", 1).put("rarity", rarity).put("price", price).put("deleted", false)
            .toString()
        executeWithReauth {
            Request.Builder()
                .url("${SupabaseCloud.base()}/rest/v1/cards")
                .addHeader("apikey", SupabaseCloud.key())
                .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia))
                .build()
        }.use { resp ->
            if (!resp.isSuccessful)
                throw RuntimeException("Hinzufügen fehlgeschlagen (${resp.code}): ${resp.body?.string()}")
        }
    }

    private suspend fun patch(row: CardRow, body: JSONObject) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/cards".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.${row.id}")
            .addQueryParameter("set_code", "eq.${row.setCode}")
            .addQueryParameter("language", "eq.${row.language}")
            .build()
        executeWithReauth {
            Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseCloud.key())
                .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
                .addHeader("Content-Type", "application/json")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia))
                .build()
        }.use { resp ->
            if (!resp.isSuccessful)
                throw RuntimeException("Aktualisieren fehlgeschlagen (${resp.code}): ${resp.body?.string()}")
        }
    }

    // Executes the request built by `buildRequest`. On a 401 (expired ~1h access token),
    // re-authenticates once via SupabaseCloud.signIn() and retries the same request once
    // (rebuilt so it picks up the fresh token) before giving up.
    private suspend fun executeWithReauth(buildRequest: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(buildRequest()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(buildRequest()).execute()
    }

    private fun parse(arr: JSONArray): List<CardRow> {
        val out = ArrayList<CardRow>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                CardRow(
                    id = o.getString("id"),
                    setCode = o.optString("set_code", "Unknown"),
                    language = o.optString("language", "DE"),
                    name = o.strOrNull("name"),
                    imageUrl = o.strOrNull("image_url"),
                    rarity = o.strOrNull("rarity"),
                    quantity = o.optInt("quantity", 0),
                    price = if (o.isNull("price")) null else o.optDouble("price", 0.0),
                    type = o.strOrNull("type"),
                    desc = o.strOrNull("desc"),
                    atk = if (o.isNull("atk")) null else o.optInt("atk"),
                    def = if (o.isNull("def")) null else o.optInt("def"),
                    level = if (o.isNull("level")) null else o.optInt("level"),
                    race = o.strOrNull("race"),
                    attribute = o.strOrNull("attribute"),
                )
            )
        }
        return out
    }

    private fun JSONObject.strOrNull(key: String): String? =
        if (isNull(key)) null else optString(key, "").ifBlank { null }
}
