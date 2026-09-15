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

data class PriceAlertEvent(
    val id: Long, val kind: String, val cardId: String, val setCode: String, val language: String, val rarity: String,
    val oldPrice: Double?, val newPrice: Double, val pct: Double?, val days: Int?, val threshold: Double?, val day: String,
)

data class PriceAlertMoveRule(val id: Long, val pct: Double, val minEur: Double, val days: Int, val active: Boolean)

data class PriceAlertTarget(
    val kind: String, val cardId: String, val setCode: String, val language: String, val rarity: String,
    val threshold: Double, val armed: Boolean,
) {
    /** Gleich CardRow.printingKey(). */
    fun key(): String = "$cardId|$setCode|$language|$rarity"
}

/**
 * Spec G2 §7 -- Preis-Alarme ueber REST (supabase/price_alerts_schema.sql). Ausgewertet wird nur in der
 * Cloud (Edge Function evaluate-price-alerts); das Handy liest Treffer, erledigt sie und pflegt Regeln.
 * Auth/Reauth wie DealsRepository.
 */
object PriceAlertsRepository {
    const val TARGET_CONFLICT = "user_id,kind,card_id,set_code,language,rarity"

    fun eventsParams(): List<Pair<String, String>> = listOf(
        "select" to "*", "dismissed" to "eq.false", "order" to "id.desc", "limit" to "200",
    )

    fun moveRuleParams(): List<Pair<String, String>> = listOf(
        "select" to "id,pct,min_eur,days,active", "kind" to "eq.move", "limit" to "1",
    )

    fun targetsParams(): List<Pair<String, String>> = listOf(
        "select" to "kind,card_id,set_code,language,rarity,threshold,armed",
        "kind" to "in.(above,below)", "active" to "eq.true",
    )

    fun targetKeyParams(card: CardRow, kind: String): List<Pair<String, String>> = listOf(
        "kind" to "eq.$kind", "card_id" to "eq.${card.id}", "set_code" to "eq.${card.setCode}",
        "language" to "eq.${card.language}", "rarity" to "eq.${card.rarity ?: "Unknown"}",
    )

    /** Ohne user_id: die Spalte hat den Standard auth.uid(). Setzen macht den Zielpreis wieder scharf (Spec §4.1). */
    fun targetBody(card: CardRow, kind: String, threshold: Double): JSONObject = JSONObject()
        .put("kind", kind).put("card_id", card.id).put("set_code", card.setCode)
        .put("language", card.language).put("rarity", card.rarity ?: "Unknown")
        .put("threshold", threshold).put("active", true).put("armed", true)

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    fun parseEvents(text: String): List<PriceAlertEvent> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceAlertEvent(
                id = o.getLong("id"), kind = o.getString("kind"), cardId = o.getString("card_id"),
                setCode = o.getString("set_code"), language = o.getString("language"), rarity = o.getString("rarity"),
                oldPrice = dbl(o, "old_price"), newPrice = o.getDouble("new_price"), pct = dbl(o, "pct"),
                days = if (o.isNull("days")) null else o.getInt("days"), threshold = dbl(o, "threshold"),
                day = o.getString("day"),
            )
        }
    }

    fun parseMoveRule(text: String): PriceAlertMoveRule? {
        val arr = JSONArray(text)
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        return PriceAlertMoveRule(
            id = o.getLong("id"), pct = o.getDouble("pct"), minEur = o.getDouble("min_eur"),
            days = o.getInt("days"), active = o.getBoolean("active"),
        )
    }

    fun parseTargets(text: String): List<PriceAlertTarget> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceAlertTarget(
                kind = o.getString("kind"), cardId = o.getString("card_id"), setCode = o.getString("set_code"),
                language = o.getString("language"), rarity = o.getString("rarity"),
                threshold = o.getDouble("threshold"), armed = o.getBoolean("armed"),
            )
        }
    }

    suspend fun loadEvents(): List<PriceAlertEvent> = parseEvents(getText("price_alert_events", eventsParams()))

    suspend fun loadMoveRule(): PriceAlertMoveRule? = parseMoveRule(getText("price_alert_rules", moveRuleParams()))

    suspend fun loadTargets(): List<PriceAlertTarget> = parseTargets(getText("price_alert_rules", targetsParams()))

    suspend fun dismissEvent(id: Long) =
        patch("price_alert_events", listOf("id" to "eq.$id"), JSONObject().put("dismissed", true), "Erledigen")

    // Nur die beim Laden angezeigten Treffer (id <= maxId), damit ein Treffer, der zwischen Laden und
    // Tippen dazukommt, nicht ungesehen mit erledigt wird (Spec G2 §5.4).
    fun dismissAllParams(maxId: Long): List<Pair<String, String>> = listOf(
        "dismissed" to "eq.false", "id" to "lte.$maxId",
    )

    suspend fun dismissAllEvents(maxId: Long) =
        patch("price_alert_events", dismissAllParams(maxId), JSONObject().put("dismissed", true), "Alle erledigen")

    /** Ohne Zeile ist der Bewegungsalarm aus; die erste Speicherung legt sie an (Spec §4.1). */
    suspend fun saveMoveRule(pct: Double, minEur: Double, days: Int, active: Boolean) {
        val body = JSONObject().put("pct", pct).put("min_eur", minEur).put("days", days).put("active", active)
        val current = loadMoveRule()
        if (current != null) {
            patch("price_alert_rules", listOf("id" to "eq.${current.id}"), body, "Bewegungsalarm speichern")
        } else {
            post("price_alert_rules", emptyList(), body.put("kind", "move"), "Bewegungsalarm speichern", upsert = false)
        }
    }

    /** threshold null = entfernen (active = false; Treffer bleiben). */
    suspend fun saveTarget(card: CardRow, kind: String, threshold: Double?) {
        if (threshold == null) {
            patch("price_alert_rules", targetKeyParams(card, kind), JSONObject().put("active", false), "Zielpreis entfernen")
        } else {
            post("price_alert_rules", listOf("on_conflict" to TARGET_CONFLICT), targetBody(card, kind, threshold), "Zielpreis speichern", upsert = true)
        }
    }

    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(table: String, params: List<Pair<String, String>>): String =
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Preis-Alarme laden fehlgeschlagen (${r.code}): $text")
            text
        }

    private suspend fun patch(table: String, params: List<Pair<String, String>>, body: JSONObject, what: String) {
        executeWithReauth {
            base(url(table, params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private suspend fun post(table: String, params: List<Pair<String, String>>, body: JSONObject, what: String, upsert: Boolean) {
        executeWithReauth {
            base(url(table, params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", if (upsert) "resolution=merge-duplicates,return=minimal" else "return=minimal")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // Bei 401 (Token nach ~1 h abgelaufen) einmal neu anmelden und wiederholen.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
