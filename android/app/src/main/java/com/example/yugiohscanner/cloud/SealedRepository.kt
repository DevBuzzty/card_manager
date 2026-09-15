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
import java.time.Instant
import java.util.UUID

/** Spec G3 §4.1/§8 -- was "Hinzufuegen" in der Cloud tut. */
sealed interface SealedAddPlan {
    /** Lebende Zeile desselben Produkts: Menge auf [quantity] setzen. */
    data class Increase(val sealedId: String, val quantity: Int) : SealedAddPlan
    /** Neue Zeile mit Name, Art und Startpreis aus der Produktliste. */
    data class Insert(val product: CatalogSealedProduct, val quantity: Int) : SealedAddPlan
}

/**
 * Spec G3 §8 -- Sealed-Bestand ueber REST (supabase/sealed_items_schema.sql, ohne user_id wie card_copies).
 * Kleine Liste, voll neu geladen (SideStores.sealedItems). Nur Soft-Delete. Auth/Reauth wie ContainersRepository.
 */
object SealedRepository {
    const val SELECT = "sealed_id,cm_product_id,name,kind,quantity,price,price_updated_at,created_at,deleted"

    fun listParams(): List<Pair<String, String>> = listOf(
        "select" to SELECT, "deleted" to "eq.false", "order" to "created_at.asc,sealed_id.asc", "limit" to "1000",
    )

    /** Schreibziel: genau diese Zeile, und nur solange sie lebt. */
    fun liveRowParams(sealedId: String): List<Pair<String, String>> =
        listOf("sealed_id" to "eq.$sealedId", "deleted" to "eq.false")

    fun parse(text: String): List<SealedItem> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SealedItem(
                sealedId = o.getString("sealed_id"),
                cmProductId = o.getLong("cm_product_id"),
                name = o.optString("name"),
                kind = o.optString("kind", "other"),
                quantity = o.getInt("quantity"),
                price = if (o.isNull("price")) null else o.getDouble("price"),
                priceUpdatedAt = if (o.isNull("price_updated_at")) null else o.getString("price_updated_at"),
                createdAt = if (o.isNull("created_at")) null else o.getString("created_at"),
                deleted = o.optBoolean("deleted", false),
            )
        }
    }

    /** Spec G3 §4.1: lebende Zeile mit gleicher cm_product_id -> Menge erhoehen (die aelteste, wie am Desktop), sonst neu. */
    fun planAdd(live: List<SealedItem>, product: CatalogSealedProduct, quantity: Int): SealedAddPlan {
        require(quantity >= 1) { "Die Menge muss mindestens 1 sein." }
        val existing = live
            .filter { !it.deleted && it.cmProductId == product.cmProductId }
            .sortedWith(compareBy<SealedItem>({ it.createdAt ?: "" }, { it.sealedId }))
            .firstOrNull()
        return if (existing != null) SealedAddPlan.Increase(existing.sealedId, existing.quantity + quantity)
        else SealedAddPlan.Insert(product, quantity)
    }

    /** Ohne deleted/created_at/updated_at: die Spalten haben Standardwerte, updated_at stempelt der Server. */
    fun insertBody(sealedId: String, product: CatalogSealedProduct, quantity: Int, nowIso: String): JSONObject = JSONObject()
        .put("sealed_id", sealedId)
        .put("cm_product_id", product.cmProductId)
        .put("name", product.name)
        .put("kind", product.kind)
        .put("quantity", quantity)
        .put("price", product.trend ?: JSONObject.NULL)
        .put("price_updated_at", if (product.trend != null) nowIso else JSONObject.NULL)

    suspend fun loadLive(): List<SealedItem> = parse(getText(listParams()))

    /** Laedt die lebenden Zeilen frisch, damit die Anlege-Entscheidung nicht auf einem alten Stand fusst. */
    suspend fun add(product: CatalogSealedProduct, quantity: Int) {
        when (val plan = planAdd(loadLive(), product, quantity)) {
            is SealedAddPlan.Increase ->
                patch(liveRowParams(plan.sealedId), JSONObject().put("quantity", plan.quantity), "Sealed hinzufügen")
            is SealedAddPlan.Insert ->
                post(insertBody(UUID.randomUUID().toString(), plan.product, plan.quantity, Instant.now().toString()), "Sealed hinzufügen")
        }
    }

    suspend fun setQuantity(sealedId: String, quantity: Int) {
        require(quantity >= 1) { "Die Menge muss mindestens 1 sein." }
        patch(liveRowParams(sealedId), JSONObject().put("quantity", quantity), "Menge speichern")
    }

    suspend fun delete(sealedId: String) {
        patch(liveRowParams(sealedId), JSONObject().put("deleted", true), "Löschen")
    }

    /** "Geoeffnet": Menge - 1; bei Menge 1 weich loeschen (die Oberflaeche fragt vorher). */
    suspend fun open(item: SealedItem) {
        if (item.quantity > 1) setQuantity(item.sealedId, item.quantity - 1) else delete(item.sealedId)
    }

    private fun url(params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/sealed_items".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(params: List<Pair<String, String>>): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Sealed-Bestand laden fehlgeschlagen (${r.code}): $text")
            text
        }
    }

    private suspend fun patch(params: List<Pair<String, String>>, body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private suspend fun post(body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(emptyList())).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
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
