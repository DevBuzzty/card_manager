package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

/**
 * eBay „zuletzt verkauft" E1 (Spec 2026-10-05 §7/§8): liest die Zeile EINES Drucks beim Öffnen des Details
 * (E1 braucht den Wert nur dort; der volle Spiegel kommt mit E2) und stößt den Einzelabruf an.
 */
object EbaySoldRepository {
    private const val COLS = "status,median_all,n_all,median_first,n_first,last_sold_at,sales"

    private fun numOrNull(o: JSONObject, k: String): Double? =
        if (!o.has(k) || o.isNull(k)) null else o.optString(k).toDoubleOrNull()

    fun parseRow(json: String): EbaySold.SoldRow? = runCatching {
        val arr = JSONArray(json)
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        val s = o.optJSONArray("sales") ?: JSONArray()
        val sales = (0 until s.length()).mapNotNull { i ->
            val x = s.optJSONObject(i) ?: return@mapNotNull null
            val price = numOrNull(x, "price") ?: return@mapNotNull null
            EbaySold.Sale(x.optString("title"), price, x.optString("sold_at"), if (x.isNull("url")) null else x.optString("url"), x.optBoolean("first"))
        }
        EbaySold.SoldRow(
            status = o.optString("status"), medianAll = numOrNull(o, "median_all"), nAll = o.optInt("n_all"),
            medianFirst = numOrNull(o, "median_first"), nFirst = o.optInt("n_first"),
            lastSoldAt = if (o.isNull("last_sold_at")) null else o.optString("last_sold_at"), sales = sales,
        )
    }.getOrNull()

    fun parseAccess(json: String): String = runCatching {
        val a = JSONArray(json).optJSONObject(0)?.optString("access")
        if (a == "aktiv" || a == "fehlt") a else "unbekannt"
    }.getOrDefault("unbekannt")

    private suspend fun get(table: String, params: List<Pair<String, String>>): String = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        fun req() = Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}").build()
        var r = SupabaseCloud.http().newCall(req()).execute()
        if (r.code == 401) { r.close(); SupabaseCloud.signIn(); r = SupabaseCloud.http().newCall(req()).execute() }
        r.use { if (it.isSuccessful) it.body?.string().orEmpty() else "[]" } // fehlende Tabelle (SQL nicht eingespielt) -> leer
    }

    /** Zugang einmal je Karte lesen (Spec §8: „nicht freigeschaltet" nur einmal), nicht je Druck. */
    suspend fun access(): String = parseAccess(get("ebay_insights_state", listOf("select" to "access", "id" to "eq.1")))

    suspend fun load(card: CardRow): EbaySold.SoldRow? =
        parseRow(get("ebay_sold_prices", listOf("select" to COLS, "card_id" to "eq.${card.id}", "set_code" to "eq.${card.setCode}",
            "language" to "eq.${card.language}", "rarity" to "eq.${card.rarity ?: ""}")))

    suspend fun check(card: CardRow): Pair<String, String?> {
        val r = EbayRepository.invoke("ebay-sold-prices", JSONObject().put("printing", JSONObject()
            .put("card_id", card.id).put("set_code", card.setCode).put("language", card.language).put("rarity", card.rarity ?: "")))
        val access = r.optString("access", "unbekannt")
        val err = if (r.optBoolean("ok") || access == "fehlt") null else r.optString("error", "eBay-Abruf fehlgeschlagen.")
        return access to err
    }
}
