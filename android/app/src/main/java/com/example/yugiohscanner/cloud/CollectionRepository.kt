package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.SyncCursor
import com.example.yugiohscanner.ml.Tags
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
    // Spalten jedes card_copies-Reads -- eine Quelle mit den Speicher-Abfragen (StoreQueries),
    // damit ein Exemplar ueberall dieselben Felder traegt. created_at und updated_at sind NUR
    // gelesen; kein Schreibweg hier sendet sie (siehe CopyRow).
    private const val COPY_COLS = StoreQueries.COPY_COLS

    private fun auth(b: Request.Builder) = b
        .addHeader("apikey", SupabaseCloud.key())
        .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    // Voll- und Delta-Abfragen des Speichers (Spec §4). Blaettern nach Schluessel, siehe Keyset.
    // Die Serverzeit kommt aus dem `Date`-Header der ERSTEN Seite (Spec §4.3, SyncCursor.lowerBound).
    suspend fun fetchCards(changedSince: String?): Fetched<CardRow> =
        fetchAll { after -> getPage("cards", StoreQueries.cards(changedSince, after), "Karten laden") { parse(it) } }

    suspend fun fetchCopies(changedSince: String?): Fetched<CopyRow> =
        fetchAll { after -> getPage("card_copies", StoreQueries.copies(changedSince, after), "Exemplare laden") { parseCopies(it) } }

    private suspend fun <T> fetchAll(page: suspend (after: T?) -> Pair<List<T>, String?>): Fetched<T> {
        var serverTime: String? = null
        val rows = KeysetPager.all<T>(StoreQueries.PAGE) { after ->
            val (rows, date) = page(after)
            if (after == null) serverTime = SyncCursor.parseHttpDate(date)
            rows
        }
        return Fetched(rows, serverTime)
    }

    /** Eine Seite plus roher `Date`-Header der Antwort. */
    private suspend fun <T> getPage(
        table: String,
        params: List<Pair<String, String>>,
        what: String,
        parseRows: (JSONArray) -> List<T>,
    ): Pair<List<T>, String?> = withContext(Dispatchers.IO) {
        val b = "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
        for ((k, v) in params) b.addQueryParameter(k, v)
        executeWithReauth { auth(Request.Builder().url(b.build())).get().build() }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${resp.code}): $text")
            parseRows(JSONArray(text)) to resp.header("Date")
        }
    }

    private suspend fun copiesOf(p: CardRow, edition: String? = null, condition: String? = null): List<CopyRow> = withContext(Dispatchers.IO) {
        val b = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("select", COPY_COLS)
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

    // Returns the copy_ids just created (in insertion order) -- Spec B2 Task 5 needs the FIRST one
    // to hand the Einsortier-Modus's reserved location to (ScanStagingScreen's "Alle uebernehmen").
    suspend fun addCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): List<String> = withContext(Dispatchers.IO) {
        ensureMigrated(printing)
        insertCopies(printing, edition, condition, count)
    }

    // POSTs the copy rows with no migration guard. Only safe right after the printing row
    // itself was just created (addPrinting) — there is nothing to double-count against yet.
    // Returns the generated copy_ids in insertion order (see addCopies above).
    private suspend fun insertCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): List<String> = withContext(Dispatchers.IO) {
        val ids = List(maxOf(1, count)) { UUID.randomUUID().toString() }
        val arr = JSONArray()
        for (copyId in ids) {
            arr.put(JSONObject()
                .put("copy_id", copyId)
                .put("card_id", printing.id).put("set_code", printing.setCode)
                .put("language", printing.language).put("rarity", printing.rarity ?: "Unknown")
                .put("edition", edition).put("condition", condition).put("deleted", false))
        }
        executeWithReauth {
            auth(Request.Builder().url("${SupabaseCloud.base()}/rest/v1/card_copies"))
                .addHeader("Content-Type", "application/json").addHeader("Prefer", "return=minimal")
                .post(arr.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Exemplar anlegen fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
        ids
    }

    // Spec H1 §5.3: markierte Exemplare (for_sale) zuerst, sonst die bisherige Reihenfolge (neueste zuerst, wie copiesOf liefert).
    internal fun removalOrder(copies: List<CopyRow>): List<CopyRow> = copies.sortedByDescending { it.forSale }

    suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int = withContext(Dispatchers.IO) {
        val victims = removalOrder(copiesOf(printing, edition, condition)).take(maxOf(1, count))
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

    // internal statt private: SaleCopiesRepoTest prueft das Lesen von for_sale (Spec H1 §8).
    internal fun parseCopies(arr: JSONArray): List<CopyRow> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        CopyRow(
            copyId = o.getString("copy_id"), cardId = o.getString("card_id"),
            setCode = o.optString("set_code", "Unknown"), language = o.optString("language", "DE"),
            rarity = o.optString("rarity", "Unknown"), edition = o.optString("edition", "unknown"),
            condition = o.optString("condition", "NM"), deleted = o.optBoolean("deleted", false),
            containerId = if (o.isNull("container_id")) null else o.optString("container_id"),
            page = if (o.isNull("page")) null else o.optInt("page"),
            slot = if (o.isNull("slot")) null else o.optInt("slot"),
            tags = if (o.isNull("tags")) null else o.optString("tags"),
            note = if (o.isNull("note")) null else o.optString("note"),
            createdAt = if (o.isNull("created_at")) null else o.optString("created_at"),
            updatedAt = if (o.isNull("updated_at")) null else o.optString("updated_at"),
            forSale = o.optBoolean("for_sale", false),
        )
    }

    /**
     * Spec H1 §6: Query-Parameter eines for_sale-PATCH fuer einen Block copy_ids -- nur lebende Exemplare und nur solche mit
     * anderem Wert, damit ein wiederholter Aufruf nichts neu stempelt. Rein, damit ohne Server testbar.
     */
    internal fun forSalePatchParams(ids: List<String>, value: Boolean): List<Pair<String, String>> = listOf(
        "copy_id" to "in.(${ids.joinToString(",") { "\"$it\"" }})",
        "deleted" to "eq.false",
        "for_sale" to "eq.${!value}",
    )

    /**
     * Spec H1 §6: Verkaufsliste umschalten, in Bloecken zu 100 copy_ids. `updated_at` stempelt der Server (Delta-Abgleich).
     * Aufrufer laufen durch das InFlight-Gatter und gleichen danach mit CollectionStore.awaitSync() ab.
     */
    suspend fun setForSale(copyIds: List<String>, value: Boolean) = withContext(Dispatchers.IO) {
        for (chunk in copyIds.distinct().chunked(100)) {
            val b = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            for ((k, v) in forSalePatchParams(chunk, value)) b.addQueryParameter(k, v)
            val body = JSONObject().put("for_sale", value)
            executeWithReauth {
                auth(Request.Builder().url(b.build())).addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Verkaufsliste ändern fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
        }
    }

    // Bindet die "Box und Deckbox haben keine Seiten"-Regel an den Aufruf selbst, nicht an die
    // Oberflaeche -- genau wie setCopyLocation() in desktop/electron/copies.cjs. Ein Behaelter,
    // der kein `binder` ist (oder gar keiner), bekommt niemals page/slot.
    private suspend fun containerKind(containerId: String): String? = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/containers".toHttpUrl().newBuilder()
            .addQueryParameter("select", "kind")
            .addQueryParameter("container_id", "eq.$containerId")
            .addQueryParameter("deleted", "eq.false")
            .build()
        executeWithReauth { auth(Request.Builder().url(url)).get().build() }.use { resp ->
            val text = resp.body?.string() ?: "[]"
            if (!resp.isSuccessful) throw RuntimeException("Behälter nachschlagen fehlgeschlagen (${resp.code}): $text")
            val arr = JSONArray(text)
            if (arr.length() == 0) null else arr.getJSONObject(0).optString("kind")
        }
    }

    suspend fun setCopyLocation(copyId: String, containerId: String?, page: Int?, slot: Int?) = withContext(Dispatchers.IO) {
        val isBinder = containerId != null &&
            (containerKind(containerId) ?: throw RuntimeException("Behälter nicht gefunden.")) == "binder"
        val body = JSONObject()
            .put("container_id", containerId ?: JSONObject.NULL)
            .put("page", if (isBinder) (page ?: JSONObject.NULL) else JSONObject.NULL)
            .put("slot", if (isBinder) (slot ?: JSONObject.NULL) else JSONObject.NULL)
        patchCopy(copyId, body)
    }

    // Schreibt Tags ausschliesslich ueber Tags.serialize() -- nie eine selbst gebaute Zeichenkette.
    suspend fun setCopyTagsNote(copyId: String, tags: List<String>, note: String?) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("tags", Tags.serialize(tags) ?: JSONObject.NULL)
            .put("note", note ?: JSONObject.NULL)
        patchCopy(copyId, body)
    }

    // Copy_id-genauer Soft-Delete -- das exemplarbezogene Gegenstueck zu removeCopies() (waehlt
    // ueber Edition/Zustand/Erstellzeit aus einer ganzen Gruppe). Seit jedes Exemplar eigene
    // Standort-, Tag- und Notizdaten traegt, ist es NICHT mehr egal, welches physische Exemplar
    // geloescht wird -- CopySheet kennt die copy_id des geoeffneten Exemplars und muss genau
    // dieses treffen (derselbe Fehler war am Desktop in Task 6, Befund A, kritisch). Niemals hart
    // loeschen; `updated_at` wird serverseitig gestempelt, also nicht mitgeschickt -- gleiches
    // Muster wie setCopyLocation/setCopyTagsNote oben (patchCopy uebernimmt Fehlerbehandlung und
    // Neuanmeldung).
    suspend fun deleteCopy(copyId: String) = withContext(Dispatchers.IO) {
        patchCopy(copyId, JSONObject().put("deleted", true))
    }

    suspend fun softDelete(row: CardRow) = withContext(Dispatchers.IO) {
        for (c in copiesOf(row)) patchCopy(c.copyId, JSONObject().put("deleted", true))
        patch(row, JSONObject().put("deleted", true))
    }

    // Creates the printing row (quantity 0; the cloud trigger counts the copies) + its copies.
    // Uses insertCopies (not addCopies) because the fresh row has quantity = 1 and no copies yet,
    // which would otherwise trip the NotMigratedException guard in ensureMigrated.
    suspend fun addPrinting(base: CardRow, setCode: String, rarity: String, price: Double, language: String = "DE",
                            edition: String, condition: String, count: Int = 1): List<String> = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("id", base.id).put("set_code", setCode).put("language", language)
            .put("name", base.name).put("type", base.type).put("desc", base.desc)
            .put("image_url", base.imageUrl).put("atk", base.atk ?: JSONObject.NULL)
            .put("def", base.def ?: JSONObject.NULL).put("level", base.level ?: JSONObject.NULL)
            .put("race", base.race).put("attribute", base.attribute)
            .put("rarity", rarity).put("price", price).put("deleted", false)
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
        insertCopies(printing, edition, condition, count)
    }

    // Autonomous scan flow: add `count` copies under the (validated) printing; the printing row is
    // created when missing. Un-deleting a tombstoned printing happens through the cloud trigger.
    // Returns the created copy_ids (see insertCopies) -- Spec B2 Task 5's caller uses the first one
    // to apply an Einsortier-Modus reservation via setCopyLocation.
    suspend fun addScanned(base: CardRow, setCode: String, rarity: String, language: String,
                           edition: String, condition: String, count: Int = 1): List<String> = withContext(Dispatchers.IO) {
        val existing = getRow(base.id, setCode, language, rarity)
        if (existing != null) {
            addCopies(existing, edition, condition, count)
        } else {
            addPrinting(base, setCode, rarity, 0.0, language, edition, condition, count)
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

    // internal statt private: CardRowParseTest prueft das Lesen der 1st-Ed-Felder (Spec G4).
    internal fun parse(arr: JSONArray): List<CardRow> {
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
                    deleted = o.optBoolean("deleted", false),
                    updatedAt = o.strOrNull("updated_at"),
                    priceLocked = if (o.isNull("price_locked")) 0 else o.optInt("price_locked", 0),
                    priceFirstEd = if (o.isNull("price_first_ed")) null else o.optDouble("price_first_ed"),
                    cmFirstEdFactor = if (o.isNull("cm_first_ed_factor")) null else o.optDouble("cm_first_ed_factor"),
                )
            )
        }
        return out
    }

    private fun JSONObject.strOrNull(key: String): String? =
        if (isNull(key)) null else optString(key, "").ifBlank { null }
}
