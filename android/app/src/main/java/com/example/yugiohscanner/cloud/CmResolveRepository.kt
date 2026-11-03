package com.example.yugiohscanner.cloud

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Spec 2026-11-03 §6 -- Client der Edge Function `resolve-cm-product` (Vertrag §5.2, Fixture docs/fixtures/cm-resolve/contract.json):
 * druckgenaue Cardmarket-Zuordnung on demand, nur auf der Ergebnis-Seite, nur online und angemeldet. Ergebnisse liegen nur im
 * Sitzungsspeicher (kein Plattenspeicher) und werden **nur angezeigt** -- nie in die Sammlung, `cm_product_id` oder Valuation.
 * Muster Einzelabruf mit Nutzer-JWT wie EbayRepository.invoke (Spec 2026-10-05 E1).
 */
object CmResolveRepository {
    /** `status` ∈ resolved|ambiguous|not_found; `cm` bei resolved genau 1, bei ambiguous ≥ 2, bei not_found leer. */
    data class LiveCm(val status: String, val how: String?, val cm: List<Int>)

    data class Antwort(val ok: Boolean, val fehler: String?, val indexDate: String?, val priceDate: String?,
                       val ab: Double?, val ergebnisse: Map<String, LiveCm>,          // Schluessel liveKey (code_key|rarity_key)
                       val preise: Map<Int, Pair<Double?, Double?>>)                  // id -> (trend, low)

    data class Stand(val ergebnisse: Map<String, LiveCm>, val preise: Map<Int, Pair<Double?, Double?>>,
                     val ab: Double?, val priceDate: String?) {
        fun trend(id: Int): Double? = preise[id]?.first
        fun low(id: Int): Double? = preise[id]?.second
        companion object { val LEER = Stand(emptyMap(), emptyMap(), null, null) }
    }

    const val MAX_DRUCKE = 10
    const val SPERRE_MS = 60_000L
    private const val TIMEOUT_S = 6L
    private const val FEHLER_TEXT = "Live-Suche fehlgeschlagen."

    // ---- Naehte fuer Tests (Spec §6.2) -----------------------------------------------------------------------------
    internal var senden: suspend (body: String) -> Pair<Int, String?> = { sendenEcht(it) }
    internal var anmelden: suspend () -> Unit = { SupabaseCloud.signIn() }
    internal var jetzt: () -> Long = { System.currentTimeMillis() }
    internal var scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    internal var protokoll: (String, String) -> Unit = { t, m -> com.example.yugiohscanner.ml.ScanLog.line(t, m) }

    private val client by lazy { SupabaseCloud.http().newBuilder().callTimeout(TIMEOUT_S, TimeUnit.SECONDS).build() }

    // ---- Sitzungsspeicher (Spec §6.3) ------------------------------------------------------------------------------
    private class Karte(val ergebnisse: ConcurrentHashMap<String, LiveCm> = ConcurrentHashMap(),
                        val preise: ConcurrentHashMap<Int, Pair<Double?, Double?>> = ConcurrentHashMap(),
                        @Volatile var ab: Double? = null, @Volatile var priceDate: String? = null)
    private val karten = ConcurrentHashMap<String, Karte>()
    private val laufend = ConcurrentHashMap<Long, Pair<String, Set<String>>>()      // Anfrage-Nr. -> (cardId, liveKeys)
    private val gesperrtBis = ConcurrentHashMap<String, Long>()
    // cardId -> Schluessel fehlgeschlagener Anfragen, die seither nicht gelungen sind (je Schluessel, Review-Nachtrag 2)
    private val fehlKeys = ConcurrentHashMap<String, Set<String>>()
    private val naechsteNr = AtomicLong()

    /** Zaehlt jede Aenderung (Start/Ende einer Anfrage); die Seite liest daraus `stand`/`laeuft` neu. */
    private val _version = MutableStateFlow(0L)
    val version: StateFlow<Long> = _version.asStateFlow()
    private fun geaendert() = _version.update { it + 1 }

    fun stand(cardId: String): Stand = karten[cardId]?.let { Stand(HashMap(it.ergebnisse), HashMap(it.preise), it.ab, it.priceDate) }
        ?: Stand.LEER
    fun bekannt(cardId: String, liveKey: String): Boolean = karten[cardId]?.ergebnisse?.containsKey(liveKey) == true
    fun laeuft(cardId: String): Set<String> = laufend.values.filter { it.first == cardId }.flatMap { it.second }.toSet()
    fun gesperrt(cardId: String): Boolean = gesperrtBis[cardId]?.let { it > jetzt() } == true
    /** Schluessel fehlgeschlagener Anfragen dieser Karte, die seither nicht gelungen sind (Zustand FEHLER, mit `!bekannt`). */
    fun fehlgeschlagen(cardId: String): Set<String> = fehlKeys[cardId] ?: emptySet()

    internal fun zuruecksetzen() {
        karten.clear(); laufend.clear(); gesperrtBis.clear(); fehlKeys.clear(); geaendert()
    }

    /** Spec §6.1: online = Netz mit NET_CAPABILITY_INTERNET (wie CatalogSync). */
    fun online(context: Context): Boolean = runCatching {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }.getOrDefault(false)

    /** Spec §6.1 -- entspricht `code_key|rarity_key` der Antwort; ohne Sprache (Europa-Regel liegt bei den Aufrufern). */
    fun liveKey(setCode: String, rarity: String): String =
        (CodeKey.of(setCode) ?: setCode.trim().uppercase()) + "|" + (RarityNorm.key(rarity) ?: "")

    /**
     * Spec §6.1 -- fragt die Drucke ([drucke]: set_code, rarity) einer Karte live an. Laeuft im eigenen Scope: verlaesst der
     * Nutzer die Seite, endet nur das Warten, die Antwort fuellt trotzdem den Sitzungsspeicher. Schon bekannte oder gerade
     * laufende Schluessel werden nicht erneut gesendet; bleibt nichts uebrig oder ist die Karte gesperrt -> sofort `null`.
     * Ergebnis: die Antwort (auch `ok = false`) oder `null` (Netz, Timeout, kein Body, kein `ok`). Wirft nie.
     */
    fun anfragen(cardId: String, nameEn: String?, drucke: List<Pair<String, String>>): Deferred<Antwort?> {
        val schonDa = laeuft(cardId)
        val neu = LinkedHashMap<String, Pair<String, String>>()
        for (p in drucke) {
            if (p.first.trim().equals("Unknown", true)) continue
            val k = liveKey(p.first, p.second)
            if (k in schonDa || bekannt(cardId, k) || k in neu) continue
            neu[k] = p
            if (neu.size == MAX_DRUCKE) break
        }
        if (neu.isEmpty() || gesperrt(cardId)) return CompletableDeferred<Antwort?>().apply { complete(null) }
        val nr = naechsteNr.incrementAndGet()
        laufend[nr] = cardId to neu.keys.toSet()
        geaendert()
        val body = requestBody(cardId, nameEn, neu.values.toList())
        return scope.async {
            val t0 = jetzt()
            val a = try { abfragen(body) } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
            if (a?.ok == true) {
                val karte = karten.getOrPut(cardId) { Karte() }
                karte.ergebnisse.putAll(a.ergebnisse)
                karte.preise.putAll(a.preise)
                a.ab?.let { karte.ab = it }
                a.priceDate?.let { karte.priceDate = it }
                // Nur die Schluessel DIESER Anfrage gelten als erledigt; Fehler und Sperre einer parallelen, fehlgeschlagenen
                // Anfrage derselben Karte bleiben (Review-Nachtrag 2). Die Sperre faellt erst, wenn kein Fehlschluessel uebrig ist.
                synchronized(fehlKeys) {
                    val rest = fehlKeys[cardId].orEmpty() - neu.keys
                    if (rest.isEmpty()) { fehlKeys.remove(cardId); gesperrtBis.remove(cardId) } else fehlKeys[cardId] = rest
                }
            } else {
                synchronized(fehlKeys) {
                    fehlKeys[cardId] = fehlKeys[cardId].orEmpty() + neu.keys
                    gesperrtBis[cardId] = jetzt() + SPERRE_MS
                }
            }
            laufend.remove(nr)
            geaendert()
            runCatching {
                protokoll("Live", "pc=$cardId n=${neu.size} " + (if (a?.ok == true) "ok treffer=${a.ergebnisse.count { it.value.cm.isNotEmpty() }}"
                    else "fehler=${a?.fehler ?: "keine Antwort"}") + " dauer=${jetzt() - t0}ms")
            }
            a
        }
    }

    /** Spec §6.2: erst HTTP 401 -> einmal anmelden und einmal wiederholen, dann den Body auswerten (egal welcher HTTP-Code). */
    internal suspend fun abfragen(body: String): Antwort? {
        var (code, text) = senden(body)
        if (code == 401) {
            anmelden()
            val zweiter = senden(body); code = zweiter.first; text = zweiter.second
        }
        return parseAntwort(text ?: return null)
    }

    private suspend fun sendenEcht(body: String): Pair<Int, String?> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("${SupabaseCloud.base()}/functions/v1/resolve-cm-product")
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
            .addHeader("Content-Type", "application/json")
            .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        client.newCall(req).execute().use { it.code to it.body?.string() }
    }

    /** Spec §6.2 -- Anfrage-Body (§5.2); `name_en` fehlt bei null/leer, hoechstens [MAX_DRUCKE] Drucke. */
    internal fun requestBody(cardId: String, nameEn: String?, drucke: List<Pair<String, String>>): String {
        val o = JSONObject().put("v", 1).put("card_id", cardId)
        nameEn?.trim()?.takeIf { it.isNotEmpty() }?.let { o.put("name_en", it) }
        val arr = JSONArray()
        drucke.take(MAX_DRUCKE).forEach { (code, rarity) -> arr.put(JSONObject().put("set_code", code).put("rarity", rarity)) }
        return o.put("printings", arr).toString()
    }

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.optString(k)
    private fun num(o: JSONObject, k: String): Double? = if (!o.has(k) || o.isNull(k)) null else (o.opt(k) as? Number)?.toDouble()
    private fun numAt(a: JSONArray, i: Int): Double? = if (i >= a.length() || a.isNull(i)) null else (a.opt(i) as? Number)?.toDouble()

    /**
     * Spec §6.2 -- rein. `null` = kein JSON-Objekt oder kein boolesches `ok` (z. B. Gateway-401, 546, HTML). `ok: false` ->
     * Antwort mit `fehler`. Ergebnisse unter `code_key|rarity_key`, Preise `"<id>": [trend|null, low|null]`.
     */
    internal fun parseAntwort(json: String): Antwort? = runCatching {
        val o = JSONObject(json)
        val ok = o.opt("ok") as? Boolean ?: return null
        if (!ok) return Antwort(false, str(o, "error")?.takeIf { it.isNotBlank() } ?: FEHLER_TEXT, null, null, null, emptyMap(), emptyMap())
        val ergebnisse = LinkedHashMap<String, LiveCm>()
        val res = o.optJSONArray("results") ?: JSONArray()
        for (i in 0 until res.length()) {
            val r = res.optJSONObject(i) ?: continue
            val codeKey = str(r, "code_key") ?: continue
            val cmArr = r.optJSONArray("cm") ?: JSONArray()
            val cm = (0 until cmArr.length()).mapNotNull { (cmArr.opt(it) as? Number)?.toInt() }
            ergebnisse["$codeKey|${str(r, "rarity_key") ?: ""}"] = LiveCm(str(r, "status") ?: "not_found", str(r, "how"), cm)
        }
        val preise = LinkedHashMap<Int, Pair<Double?, Double?>>()
        o.optJSONObject("prices")?.let { p ->
            val namen = p.names() ?: JSONArray()
            for (i in 0 until namen.length()) {
                val k = namen.optString(i)
                val id = k.toIntOrNull() ?: continue
                val a = p.optJSONArray(k) ?: continue
                preise[id] = numAt(a, 0) to numAt(a, 1)
            }
        }
        val card = o.optJSONObject("card")
        Antwort(true, null, str(o, "index_date"), str(o, "price_date"), card?.let { num(it, "ab") }, ergebnisse, preise)
    }.getOrNull()
}
