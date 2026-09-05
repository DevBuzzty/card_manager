package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// A printing has quantity > 0 in `cards` but no live rows in `card_copies` yet — the desktop
// hasn't pushed its backfill of that printing's copies. Adding copies now would double-count
// once it does, so callers must retry after the desktop syncs.
class NotMigratedException(message: String) : RuntimeException(message)

// Reads and mutates the Supabase `cards` / `card_copies` tables over REST. Every physical card
// is a row in `card_copies`; a cloud trigger recounts `cards.quantity`/`deleted` from live copies,
// so the phone inserts or soft-deletes copies rather than PATCHing quantity directly.
object CollectionRepository {
    private const val PAGE = 1000

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

    private fun auth(b: Request.Builder) = b
        .addHeader("apikey", SupabaseCloud.key())
        .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    suspend fun loadCopies(): List<CopyRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<CopyRow>()
        var offset = 0
        while (true) {
            val url = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
                .addQueryParameter("select", "copy_id,card_id,set_code,language,rarity,edition,condition,deleted")
                .addQueryParameter("deleted", "eq.false")
                .addQueryParameter("order", "copy_id.asc")
                .addQueryParameter("limit", PAGE.toString())
                .addQueryParameter("offset", offset.toString())
                .build()
            val page = executeWithReauth { auth(Request.Builder().url(url)).get().build() }.use { resp ->
                val text = resp.body?.string() ?: "[]"
                if (!resp.isSuccessful) throw RuntimeException("Exemplare laden fehlgeschlagen (${resp.code}): $text")
                parseCopies(JSONArray(text))
            }
            out.addAll(page)
            if (page.size < PAGE) break
            offset += PAGE
        }
        out
    }

    private suspend fun copiesOf(p: CardRow, edition: String? = null, condition: String? = null): List<CopyRow> = withContext(Dispatchers.IO) {
        val b = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("select", "copy_id,card_id,set_code,language,rarity,edition,condition,deleted")
            .addQueryParameter("card_id", "eq.${p.id}")
            .addQueryParameter("set_code", "eq.${p.setCode}")
            .addQueryParameter("language", "eq.${p.language}")
            .addQueryParameter("rarity", "eq.${p.rarity ?: "Unknown"}")
            .addQueryParameter("deleted", "eq.false")
            .addQueryParameter("order", "created_at.desc")
        if (edition != null) b.addQueryParameter("edition", "eq.$edition")
        if (condition != null) b.addQueryParameter("condition", "eq.$condition")
        executeWithReauth { auth(Request.Builder().url(b.build())).get().build() }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Exemplare laden fehlgeschlagen (${resp.code}): $text")
            parseCopies(JSONArray(text))
        }
    }

    // A printing that still has quantity > 0 but no copies was not backfilled yet (desktop-only step).
    // Adding copies now would double-count once the desktop pushes its backfill -> refuse.
    private suspend fun ensureMigrated(p: CardRow) {
        val row = getRow(p.id, p.setCode, p.language, p.rarity) ?: return
        if (row.quantity > 0 && copiesOf(p).isEmpty())
            throw NotMigratedException("Sammlung noch nicht migriert – bitte die Desktop-App einmal starten (Sync).")
    }

    suspend fun addCopies(printing: CardRow, edition: String, condition: String, count: Int = 1) = withContext(Dispatchers.IO) {
        ensureMigrated(printing)
        val arr = JSONArray()
        repeat(maxOf(1, count)) {
            arr.put(JSONObject()
                .put("copy_id", UUID.randomUUID().toString())
                .put("card_id", printing.id).put("set_code", printing.setCode)
                .put("language", printing.language).put("rarity", printing.rarity ?: "Unknown")
                .put("edition", edition).put("condition", condition).put("deleted", false))
        }
        executeWithReauth {
            auth(Request.Builder().url("${SupabaseCloud.base()}/rest/v1/card_copies"))
                .addHeader("Content-Type", "application/json").addHeader("Prefer", "return=minimal")
                .post(arr.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Exemplar anlegen fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
    }

    suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int = withContext(Dispatchers.IO) {
        val victims = copiesOf(printing, edition, condition).take(maxOf(1, count))
        for (c in victims) patchCopy(c.copyId, JSONObject().put("deleted", true))
        victims.size
    }

    suspend fun updateCopyGroup(printing: CardRow, fromEdition: String, fromCondition: String, toEdition: String, toCondition: String): Int = withContext(Dispatchers.IO) {
        val rows = copiesOf(printing, fromEdition, fromCondition)
        for (c in rows) patchCopy(c.copyId, JSONObject().put("edition", toEdition).put("condition", toCondition))
        rows.size
    }

    private suspend fun patchCopy(copyId: String, body: JSONObject) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("copy_id", "eq.$copyId").build()
        executeWithReauth {
            auth(Request.Builder().url(url)).addHeader("Content-Type", "application/json")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Exemplar ändern fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
    }

    private fun parseCopies(arr: JSONArray): List<CopyRow> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        CopyRow(
            copyId = o.getString("copy_id"), cardId = o.getString("card_id"),
            setCode = o.optString("set_code", "Unknown"), language = o.optString("language", "DE"),
            rarity = o.optString("rarity", "Unknown"), edition = o.optString("edition", "unknown"),
            condition = o.optString("condition", "NM"), deleted = o.optBoolean("deleted", false),
        )
    }

    suspend fun softDelete(row: CardRow) = withContext(Dispatchers.IO) {
        for (c in copiesOf(row)) patchCopy(c.copyId, JSONObject().put("deleted", true))
        patch(row, JSONObject().put("deleted", true).put("quantity", 0))
    }

    // Creates the printing row (quantity 0; the cloud trigger counts the copies) + its copies.
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double, language: String = "DE",
                            edition: String, condition: String, count: Int = 1) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", language)
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("quantity", 0).put("rarity", rarity).put("price", price).put("deleted", false)
            .toString()
        executeWithReauth {
            auth(Request.Builder().url("${SupabaseCloud.base()}/rest/v1/cards"))
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("Hinzufügen fehlgeschlagen (${resp.code}): ${resp.body?.string()}")
        }
        val printing = CardRow(base.id, setCode, language, base.name, base.imageUrl, rarity, 0, price)
        addCopies(printing, edition, condition, count)
    }

    // Autonomous scan flow: add `count` copies under the (validated) printing; the printing row is
    // created when missing. Un-deleting a tombstoned printing happens through the cloud trigger.
    suspend fun addScanned(base: CardRow, setCode: String, rarity: String, language: String,
                           edition: String, condition: String, count: Int = 1): String = withContext(Dispatchers.IO) {
        val existing = getRow(base.id, setCode, language, rarity)
        val label = base.name ?: base.id
        if (existing != null) {
            addCopies(existing, edition, condition, count)
            "$label → +$count× ($setCode)"
        } else {
            addPrinting(base, setCode, rarity, 0.0, language, edition, condition, count)
            "$label hinzugefügt ($setCode)"
        }
    }

    // Fetches a single row by composite key (id, set_code, language, rarity), or null if absent.
    // rarity is part of the identity — the same set code in two rarities are distinct printings.
    private suspend fun getRow(id: String, setCode: String, language: String, rarity: String?): CardRow? = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/cards".toHttpUrl().newBuilder()
            .addQueryParameter("select", "*")
            .addQueryParameter("id", "eq.$id")
            .addQueryParameter("set_code", "eq.$setCode")
            .addQueryParameter("language", "eq.$language")
            .addQueryParameter("rarity", "eq.${rarity ?: "Unknown"}")
            .build()
        executeWithReauth {
            Request.Builder().url(url)
                .addHeader("apikey", SupabaseCloud.key())
                .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
                .get().build()
        }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Nachschlagen fehlgeschlagen (${resp.code}): $text")
            parse(JSONArray(text)).firstOrNull()
        }
    }

    private suspend fun patch(row: CardRow, body: JSONObject) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/cards".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.${row.id}")
            .addQueryParameter("set_code", "eq.${row.setCode}")
            .addQueryParameter("language", "eq.${row.language}")
            .addQueryParameter("rarity", "eq.${row.rarity ?: "Unknown"}")
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
