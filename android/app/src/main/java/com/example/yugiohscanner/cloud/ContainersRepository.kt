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

data class ContainerRow(
    val containerId: String, val name: String, val kind: String,
    val pocketsPerPage: Int?, val color: String?, val sortOrder: Int,
)

private val CONTAINER_KINDS = setOf("binder", "box", "deckbox")
private val BINDER_POCKETS = setOf(4, 9, 12)

// Reads/writes the Supabase `containers` table over REST, so the phone's Einsortier-Modus
// (Task 9/10) works without the desktop. Mirrors DecksRepository's auth/reauth pattern -- the
// table itself already exists in Supabase (created by hand); this repository does not touch
// its schema.
object ContainersRepository {

    suspend fun list(): List<ContainerRow> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/containers".toHttpUrl().newBuilder()
            .addQueryParameter("select", "container_id,name,kind,pockets_per_page,color,sort_order")
            .addQueryParameter("deleted", "eq.false")
            .addQueryParameter("order", "sort_order.asc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseContainer(arr.getJSONObject(it)) } }
    }

    // Upsert ueber die Primaerschluessel-Spalte container_id: legt neu an oder aktualisiert,
    // je nachdem ob die Zeile schon existiert. Der Aufrufer erzeugt die container_id (UUID) beim
    // Neuanlegen selbst -- genau wie insertCopies() in CollectionRepository die copy_id erzeugt.
    //
    // Die Pruefung wohnt HIER, nicht nur in BindersScreen: der Cloud-Weg des Handys geht direkt
    // in die Supabase-Tabelle, an keinem Desktop-Helfer vorbei -- dieselbe Ueberlegung wie bei
    // setCopyLocation() oben. Mirrors saveContainer() in desktop/electron/copies.cjs.
    suspend fun save(row: ContainerRow) = withContext(Dispatchers.IO) {
        val cleanName = row.name.trim()
        if (cleanName.isEmpty()) throw RuntimeException("Der Behälter braucht einen Namen.")
        if (row.kind !in CONTAINER_KINDS) throw RuntimeException("Unbekannte Behälterart.")
        // Box und Deckbox haben keine Seiten: pocketsPerPage wird verworfen, nicht abgelehnt --
        // dieselbe Bauart wie setCopyLocation es mit page/slot bei Nicht-Ordnern macht.
        val pockets = if (row.kind == "binder") {
            if (row.pocketsPerPage !in BINDER_POCKETS) throw RuntimeException("Ein Ordner hat 4, 9 oder 12 Fächer pro Seite.")
            row.pocketsPerPage
        } else null

        val body = JSONObject()
            .put("container_id", row.containerId)
            .put("name", cleanName)
            .put("kind", row.kind)
            .put("pockets_per_page", pockets ?: JSONObject.NULL)
            .put("color", row.color ?: JSONObject.NULL)
            .put("sort_order", row.sortOrder)
            .toString()
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/containers".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Behälter speichern", r) }
    }

    // Bindende Reihenfolge (Spec B1 §8): erst ALLE Exemplare dieses Behaelters auf
    // container_id/page/slot = NULL setzen, DANN den Behaelter auf deleted = true. Zwei
    // REST-Aufrufe, in dieser Reihenfolge -- bricht der zweite ab, stehen Exemplare ohne
    // Behaelter da (unschoen, aber harmlos); andersherum zeigten Exemplare auf einen geloeschten
    // Behaelter, und es gibt bewusst keinen Fremdschluessel, der das abfaengt.
    suspend fun delete(containerId: String) = withContext(Dispatchers.IO) {
        val copiesUrl = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            .addQueryParameter("container_id", "eq.$containerId").build()
        val clearBody = JSONObject()
            .put("container_id", JSONObject.NULL).put("page", JSONObject.NULL).put("slot", JSONObject.NULL)
            .toString()
        executeWithReauth {
            base(copiesUrl).addHeader("Content-Type", "application/json")
                .patch(clearBody.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Standorte räumen", r) }

        val containerUrl = "${SupabaseCloud.base()}/rest/v1/containers".toHttpUrl().newBuilder()
            .addQueryParameter("container_id", "eq.$containerId").build()
        val deleteBody = JSONObject().put("deleted", true).toString()
        executeWithReauth {
            base(containerUrl).addHeader("Content-Type", "application/json")
                .patch(deleteBody.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Behälter löschen", r) }
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

    private fun parseContainer(o: JSONObject) = ContainerRow(
        containerId = o.getString("container_id"),
        name = o.optString("name"),
        kind = o.optString("kind"),
        pocketsPerPage = if (o.isNull("pockets_per_page")) null else o.optInt("pockets_per_page"),
        color = if (o.isNull("color")) null else o.optString("color"),
        sortOrder = o.optInt("sort_order", 0),
    )
}
