package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.ImportCard
import com.example.yugiohscanner.ml.LegalityCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

// Spec E2 §5: notes = "Nicht übernommen beim Import:" …, am Handy nur Anzeige.
// Spec E3 §4: format tcg | ocg | free; fehlt die Spalte (SQL nicht eingespielt) -> tcg.
data class Deck(val id: Long, val name: String, val containerId: String? = null, val notes: String? = null, val format: String = "tcg")

/** Spec E3 §5: Ergebnis der Pruefung vor "Hinzufügen" -- blockiert, bestehende Zeile erhoehen oder neue Zeile anlegen. */
sealed interface AddCopyPlan {
    object Blocked : AddCopyPlan
    data class Increment(val deckCardId: Long, val count: Int) : AddCopyPlan
    object Insert : AddCopyPlan
}
data class DeckCard(
    val id: Long, val cardId: String, val name: String?, val imageUrl: String?,
    val count: Int, val section: String,
    // Spec E1 §4: nur bei loadAllCards gesetzt (Deck-Liste mit Zahlen); loadCards(deckId) kennt das Deck ohnehin.
    val deckId: Long = 0L,
)

// Reads/writes the Supabase decks / deck_cards tables over REST, so the phone's
// Deck-Builder works without the desktop. Mirrors DealsRepository's auth/reauth pattern.
object DecksRepository {

    suspend fun loadDecks(): List<Deck> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            // Spec E1: select=* liefert container_id mit, sobald decks_container.sql eingespielt ist.
            .addQueryParameter("select", "*")
            .addQueryParameter("order", "created_at.desc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseDeck(arr.getJSONObject(it)) } }
    }

    /** Spec E2 §5: [notes] nur mitsenden, wenn es welche gibt (ein Import ohne Nicht-Uebernommenes klappt so auch vor decks_notes.sql). */
    suspend fun createDeck(name: String, notes: String? = null): Long = withContext(Dispatchers.IO) {
        val body = JSONObject().put("name", name).apply { if (notes != null) put("notes", notes) }.toString()
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

    /** Spec E1 §4: alle Deckkarten aller Decks in einer Abfrage (Deck-Liste mit Zahlen, "in Deck X"). */
    suspend fun loadAllCards(): List<DeckCard> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl().newBuilder()
            .addQueryParameter("select", "id,deck_id,card_id,name,image_url,count,section")
            .addQueryParameter("order", "id.asc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseCard(arr.getJSONObject(it)) } }
    }

    const val DECKBOX_TAKEN = "Diese Deckbox gehört schon zu einem anderen Deck"

    /** Spec E1 §9: PostgREST meldet die Unique-Verletzung (decks_container_unique) als 409 mit code 23505. */
    internal fun containerErrorMessage(code: Int, body: String): String =
        if (body.contains("\"23505\"")) DECKBOX_TAKEN else "Deckbox zuordnen fehlgeschlagen ($code): $body"

    /** Spec E1 §3: Deckbox zuordnen (null = keine Box). Lehnt die Cloud ab, bleibt die Zeile unveraendert. */
    suspend fun setContainer(deckId: Long, containerId: String?) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckId").build()
        val body = JSONObject().put("container_id", containerId ?: JSONObject.NULL).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(containerErrorMessage(r.code, r.body?.string() ?: "")) }
    }

    /** Spec E3 §4/§7: Format sofort speichern. Lehnt die Cloud ab (z. B. Spalte fehlt), "Format konnte nicht gespeichert werden". */
    suspend fun setFormat(deckId: Long, format: String) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckId").build()
        val body = JSONObject().put("format", DeckLegality.normalizeFormat(format)).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(DeckLegality.FORMAT_SAVE_FAILED) }
    }

    private fun legalityCards(cards: List<DeckCard>) = cards.map { LegalityCard(it.cardId, it.name, it.count, it.section) }

    /**
     * Spec E3 §5 -- rein, damit ohne Netz testbar: TCG/OCG blockiert die 4. Kopie (Haupt-Passcode, alle Abschnitte), Frei nie.
     * Sonst erhoeht "Hinzufügen" die bestehende Zeile desselben Passcodes im selben Abschnitt (bei Doppelzeilen die erste)
     * statt eine neue anzulegen. [cards] = frischer Stand des Decks.
     */
    internal fun addCopyPlan(cards: List<DeckCard>, cardId: String, section: String, format: String, aliases: Map<String, String>?): AddCopyPlan {
        if (!DeckLegality.canAddCopy(legalityCards(cards), cardId, format, aliases)) return AddCopyPlan.Blocked
        val existing = cards.firstOrNull { it.cardId == cardId && it.section == section }
        return if (existing != null) AddCopyPlan.Increment(existing.id, existing.count + 1) else AddCopyPlan.Insert
    }

    /** Spec E3 §5: "Hinzufügen" aus der Suche. Blockiert -> Fehler "Höchstens 3 Kopien je Karte" (die Oberflaeche zeigt ihn). */
    suspend fun addCopy(
        deckId: Long, cards: List<DeckCard>, cardId: String, name: String?, imageUrl: String?, section: String,
        format: String, aliases: Map<String, String>?,
    ) {
        when (val plan = addCopyPlan(cards, cardId, section, format, aliases)) {
            AddCopyPlan.Blocked -> throw IllegalStateException(DeckLegality.COPY_LIMIT)
            is AddCopyPlan.Increment -> setCount(plan.deckCardId, plan.count)
            AddCopyPlan.Insert -> addCard(deckId, cardId, name, imageUrl, section)
        }
    }

    /** Spec E3 §5: "+" an einer Zeile -- dieselbe Grenze; gezaehlt wird mit dem frischen Stand [cards]. */
    suspend fun incrementCopy(card: DeckCard, cards: List<DeckCard>, format: String, aliases: Map<String, String>?) {
        if (!DeckLegality.canAddCopy(legalityCards(cards), card.cardId, format, aliases)) throw IllegalStateException(DeckLegality.COPY_LIMIT)
        val current = cards.firstOrNull { it.id == card.id } ?: card
        setCount(current.id, current.count + 1)
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

    /**
     * Spec E2 §5: Rueckbau beim Import -- scheitert das Einfuegen der Karten, wird das eben angelegte (leere) Deck wieder
     * geloescht und der Fehler weitergereicht. Rein, damit ohne Netz testbar.
     * ZWILLING (Rueckbau): desktop/electron/decks.cjs#createImportedDeck.
     */
    internal suspend fun createWithRollback(
        create: suspend () -> Long,
        insertCards: suspend (Long) -> Unit,
        delete: suspend (Long) -> Unit,
    ): Long {
        val id = create()
        try {
            insertCards(id)
        } catch (e: Exception) {
            // F5: bricht der Nutzer waehrend "Anlegen" ab (System-Zurueck), ist der umgebende Scope bereits
            // abgebrochen -- ohne NonCancellable wuerde der Rueckbau selbst am ersten Suspension-Punkt sofort
            // abgebrochen und das leere Deck bliebe stehen.
            withContext(NonCancellable) {
                try { delete(id) } catch (_: Exception) { /* der eigentliche Fehler zaehlt */ }
            }
            throw e
        }
        return id
    }

    /** Spec E2 §5: alle Deckkarten eines Imports als ein JSON-Array (ein Insert), Bild aus dem Katalog. */
    internal fun importCardsJson(deckId: Long, cards: List<ImportCard>, imageOf: Map<String, String?>): JSONArray =
        JSONArray().apply {
            for (c in cards) put(
                JSONObject().put("deck_id", deckId).put("card_id", c.cardId).put("name", c.name)
                    .put("image_url", imageOf[c.cardId] ?: JSONObject.NULL).put("count", c.count).put("section", c.section)
            )
        }

    /** Spec E2 §5: Import legt immer ein neues Deck an -- Deck mit Notizen, dann alle Karten in einem Insert, sonst Rueckbau. */
    suspend fun createImportedDeck(name: String, notes: String?, cards: List<ImportCard>, imageOf: Map<String, String?>): Long =
        createWithRollback(
            create = { createDeck(name, notes) },
            insertCards = { id -> if (cards.isNotEmpty()) insertCards(importCardsJson(id, cards, imageOf)) },
            delete = { id -> deleteDeck(id) },
        )

    private suspend fun insertCards(rows: JSONArray) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(rows.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Karten anlegen", r) }
    }

    /**
     * Spec E2 §6: eine Kopie verschieben ("→ Side" / "→ Deck", Ziel per DeckImport.moveTarget). Erst das Ziel erhoehen,
     * dann die Quelle senken -- scheitert der zweite Schritt, ist eine Kopie zu viel da statt eine verloren.
     */
    suspend fun moveOne(deckId: Long, card: DeckCard, deckCards: List<DeckCard>, type: String?) {
        val to = DeckImport.moveTarget(card.section, type)
        val target = deckCards.firstOrNull { it.cardId == card.cardId && it.section == to }
        if (target != null) setCount(target.id, target.count + 1)
        else addCard(deckId, card.cardId, card.name, card.imageUrl, to)
        setCount(card.id, card.count - 1)
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

    // internal statt private: DecksRepositoryTest prueft container_id und deck_id (Spec E1).
    internal fun parseDeck(o: JSONObject) = Deck(
        id = o.optLong("id"), name = o.optString("name"),
        containerId = if (o.isNull("container_id")) null else o.optString("container_id"),
        notes = if (o.isNull("notes")) null else o.optString("notes"),
        format = DeckLegality.normalizeFormat(if (o.isNull("format")) null else o.optString("format")),
    )

    internal fun parseCard(o: JSONObject) = DeckCard(
        id = o.optLong("id"), cardId = o.optString("card_id"),
        name = if (o.isNull("name")) null else o.optString("name"),
        imageUrl = if (o.isNull("image_url")) null else o.optString("image_url"),
        count = o.optInt("count", 1), section = o.optString("section", "main"),
        deckId = o.optLong("deck_id"),
    )
}
