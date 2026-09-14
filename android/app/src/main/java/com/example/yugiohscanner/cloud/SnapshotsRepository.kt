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

data class Snapshot(val day: String, val totalValue: Double)

// Portfolio value over time. The phone upserts today's total when the Start screen loads
// (one row per user per day), and reads the recent history for the value chart.
object SnapshotsRepository {

    suspend fun upsertToday(totalValue: Double, cardCount: Int) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("total_value", totalValue).put("card_count", cardCount).toString()
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/portfolio_snapshots".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Snapshot speichern", r) }
    }

    // Spec G1 §4.4: die JUENGSTEN 1000 Tage (vorher `day.asc&limit=120` = die aeltesten 120).
    fun snapshotParams(): List<Pair<String, String>> =
        listOf("select" to "day,total_value", "order" to "day.desc", "limit" to "1000")

    fun parseSnapshots(text: String): List<Snapshot> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Snapshot(o.optString("day"), o.optDouble("total_value", 0.0))
        }.reversed()
    }

    suspend fun loadSnapshots(): List<Snapshot> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/portfolio_snapshots".toHttpUrl().newBuilder()
            .apply { snapshotParams().forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Verlauf laden fehlgeschlagen (${r.code}): $text")
            parseSnapshots(text)
        }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
