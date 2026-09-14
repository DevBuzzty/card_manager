package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PriceRef
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

/**
 * Spec G1 §4.3: Referenzpreise ueber die RPC price_reference (supabase/price_reference_rpc.sql) und
 * der Verlauf eines Printings aus price_history. Nur lesend.
 */
object PriceHistoryRepository {
    private val KEY = listOf("card_id", "set_code", "language", "rarity")

    fun referenceParams(after: PriceRef?): List<Pair<String, String>> {
        val p = arrayListOf(
            "order" to KEY.joinToString(",") { "$it.asc" },
            "limit" to StoreQueries.PAGE.toString(),
        )
        if (after != null) p += "or" to Keyset.after(KEY, listOf(after.cardId, after.setCode, after.language, after.rarity))
        return p
    }

    fun historyParams(card: CardRow): List<Pair<String, String>> = listOf(
        "select" to "card_id,set_code,language,rarity,day,price,source",
        "card_id" to "eq.${card.id}",
        "set_code" to "eq.${card.setCode}",
        "language" to "eq.${card.language}",
        "rarity" to "eq.${card.rarity ?: "Unknown"}",
        "variant" to "eq.base",
        "order" to "day.desc",
        "limit" to "1000",
    )

    fun parse(text: String): List<PriceRef> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceRef(
                o.getString("card_id"), o.getString("set_code"), o.getString("language"), o.getString("rarity"),
                o.getString("day"), o.getDouble("price"), o.optString("source", "unknown"),
            )
        }
    }

    suspend fun reference(days: Int): List<PriceRef> = KeysetPager.all(StoreQueries.PAGE) { after ->
        val url = "${SupabaseCloud.base()}/rest/v1/rpc/price_reference".toHttpUrl().newBuilder()
            .apply { referenceParams(after).forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val body = JSONObject().put("days", days).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Bewegungen laden fehlgeschlagen (${r.code}): $text")
            parse(text)
        }
    }

    suspend fun history(card: CardRow): List<PriceRef> {
        val url = "${SupabaseCloud.base()}/rest/v1/price_history".toHttpUrl().newBuilder()
            .apply { historyParams(card).forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Verlauf laden fehlgeschlagen (${r.code}): $text")
            parse(text).reversed()
        }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
