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

data class Deck(val id: Long, val name: String)
data class DeckCard(
    val id: Long, val cardId: String, val name: String?, val imageUrl: String?,
    val count: Int, val section: String,
)

// Reads/writes the Supabase decks / deck_cards tables over REST, so the phone's
// Deck-Builder works without the desktop. Mirrors DealsRepository's auth/reauth pattern.
object DecksRepository {

    suspend fun loadDecks(): List<Deck> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("select", "id,name")
            .addQueryParameter("order", "created_at.desc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseDeck(arr.getJSONObject(it)) } }
    }

    suspend fun createDeck(name: String): Long = withContext(Dispatchers.IO) {
        val body = JSONObject().put("name", name).toString()
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=representation")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r ->
            val text = r.body?.string() ?: ""
            if (!r.isSuccessful) throw RuntimeException("Deck anlegen fehlgeschlagen (${r.code}): $text")
            JSONArray(text).getJSONObject(0).getLong("id")
        }
    }

    suspend fun deleteDeck(id: Long) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$id").build()
        executeWithReauth { base(url).delete().build() }
            .use { r -> if (!r.isSuccessful) err("Deck löschen", r) }
    }

    suspend fun loadCards(deckId: Long): List<DeckCard> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl().newBuilder()
            .addQueryParameter("deck_id", "eq.$deckId")
            .addQueryParameter("select", "*")
            .addQueryParameter("order", "id.asc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseCard(arr.getJSONObject(it)) } }
    }

    suspend fun addCard(deckId: Long, cardId: String, name: String?, imageUrl: String?, section: String) =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("deck_id", deckId).put("card_id", cardId)
                .put("name", name ?: JSONObject.NULL).put("image_url", imageUrl ?: JSONObject.NULL)
                .put("count", 1).put("section", section).toString()
            executeWithReauth {
                base("${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl())
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.use { r -> if (!r.isSuccessful) err("Karte hinzufügen", r) }
        }

    suspend fun setCount(deckCardId: Long, count: Int) = withContext(Dispatchers.IO) {
        if (count <= 0) return@withContext removeCard(deckCardId)
        val url = "${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckCardId").build()
        val body = JSONObject().put("count", count).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Anzahl ändern", r) }
    }

    suspend fun removeCard(deckCardId: Long) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckCardId").build()
        executeWithReauth { base(url).delete().build() }
            .use { r -> if (!r.isSuccessful) err("Karte entfernen", r) }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private suspend fun getArray(url: HttpUrl): JSONArray = withContext(Dispatchers.IO) {
        executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Laden fehlgeschlagen (${r.code}): $text")
            JSONArray(text)
        }
    }

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // On a 401 (expired ~1h token) re-auth once and retry.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }

    private fun parseDeck(o: JSONObject) = Deck(id = o.optLong("id"), name = o.optString("name"))

    private fun parseCard(o: JSONObject) = DeckCard(
        id = o.optLong("id"), cardId = o.optString("card_id"),
        name = if (o.isNull("name")) null else o.optString("name"),
        imageUrl = if (o.isNull("image_url")) null else o.optString("image_url"),
        count = o.optInt("count", 1), section = o.optString("section", "main"),
    )
}
