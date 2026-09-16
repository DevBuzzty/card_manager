package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.DeckWishlist
import com.example.yugiohscanner.ml.WishCandidate
import com.example.yugiohscanner.ml.WishResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

data class WishlistItem(
    val id: Long, val cardId: String, val name: String,
    val imageUrl: String?, val maxPrice: Double?,
)

// Reads/writes the Supabase `wishlist` table over REST. Mirrors DealsRepository's
// auth/reauth pattern. Adding a wanted card with a max price also spawns a deal-watch
// so the card is hunted across marketplaces immediately.
object WishlistRepository {

    suspend fun loadWishlist(): List<WishlistItem> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/wishlist".toHttpUrl().newBuilder()
            .addQueryParameter("select", "*")
            .addQueryParameter("order", "created_at.desc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseItem(arr.getJSONObject(it)) } }
    }

    // Spec E1 §6: triggerScrape = false beim Massen-Hinzufuegen (die Cloud-Suche laeuft dort einmal am Ende).
    // requireRealName = true NUR fuer diesen Massen-Pfad (F3-Folgefix): ein Einzel-Eintrag (WishlistScreen,
    // CardDetailScreen) legt wie vor E1 bei jedem vorhandenen Preis einen Deal-Watch an, egal ob Name und
    // cardId zufaellig gleich sind. Rueckgabe: true, wenn zusaetzlich ein Deal-Watch entstand.
    suspend fun addToWishlist(
        cardId: String, name: String, imageUrl: String?, maxPrice: Double?,
        triggerScrape: Boolean = true, requireRealName: Boolean = false,
    ): Boolean =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("card_id", cardId).put("name", name)
                .put("image_url", imageUrl ?: JSONObject.NULL)
                .put("max_price", maxPrice ?: JSONObject.NULL)
                .toString()
            executeWithReauth {
                base("${SupabaseCloud.base()}/rest/v1/wishlist".toHttpUrl())
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.use { r -> if (!r.isSuccessful) err("Wunschkarte anlegen", r) }

            // Also hunt for it as a deal-watch (best-effort — must not fail the wishlist add).
            if (!DeckWishlist.shouldCreateDealWatch(maxPrice, name, cardId, requireRealName)) return@withContext false
            try {
                // shouldCreateDealWatch==true garantiert maxPrice != null.
                DealsRepository.addWatch(name, maxPrice!!)
                if (triggerScrape) DealsRepository.triggerScrape()
                true
            } catch (_: Exception) { false /* non-fatal */ }
        }

    /** Spec E1 §6: "Fehlende auf die Wunschliste" -- Eintrag fuer Eintrag, die Cloud-Suche hoechstens einmal (DeckWishlist.addAll). */
    suspend fun addMissing(candidates: List<WishCandidate>, nameOf: (String) -> String, imageOf: (String) -> String?): WishResult =
        DeckWishlist.addAll(
            candidates,
            add = { c -> addToWishlist(c.cardId, nameOf(c.cardId), imageOf(c.cardId), c.maxPrice, triggerScrape = false, requireRealName = true) },
            triggerScrape = { DealsRepository.triggerScrape() },
        )

    suspend fun removeFromWishlist(id: Long) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/wishlist".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$id").build()
        executeWithReauth { base(url).delete().build() }
            .use { r -> if (!r.isSuccessful) err("Wunschkarte löschen", r) }
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

    private fun parseItem(o: JSONObject) = WishlistItem(
        id = o.optLong("id"), cardId = o.optString("card_id"), name = o.optString("name"),
        imageUrl = if (o.isNull("image_url")) null else o.optString("image_url"),
        maxPrice = if (o.isNull("max_price")) null else o.optDouble("max_price"),
    )
}
