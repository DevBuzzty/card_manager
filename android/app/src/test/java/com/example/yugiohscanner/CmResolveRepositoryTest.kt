package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CmResolveRepository
import com.example.yugiohscanner.cloud.CmResolveRepository.LiveCm
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Spec 2026-11-03 §6.2/§6.3/§10 -- Client fuer resolve-cm-product: Vertrag (contract.json), 401-Folge, Sitzungsspeicher, Sperre. */
@OptIn(ExperimentalCoroutinesApi::class)
class CmResolveRepositoryTest {
    private lateinit var senden0: suspend (String) -> Pair<Int, String?>
    private lateinit var anmelden0: suspend () -> Unit
    private lateinit var jetzt0: () -> Long
    private lateinit var scope0: CoroutineScope
    private lateinit var protokoll0: (String, String) -> Unit

    @Before fun setUp() {
        senden0 = CmResolveRepository.senden; anmelden0 = CmResolveRepository.anmelden
        jetzt0 = CmResolveRepository.jetzt; scope0 = CmResolveRepository.scope; protokoll0 = CmResolveRepository.protokoll
        CmResolveRepository.protokoll = { _, _ -> }
        CmResolveRepository.zuruecksetzen()
    }

    @After fun tearDown() {
        CmResolveRepository.senden = senden0; CmResolveRepository.anmelden = anmelden0
        CmResolveRepository.jetzt = jetzt0; CmResolveRepository.scope = scope0; CmResolveRepository.protokoll = protokoll0
        CmResolveRepository.zuruecksetzen()
    }

    // ---- parseAntwort gegen die geteilte Fixture --------------------------------------------------------------------

    private fun nullableDouble(a: JSONArray, i: Int): Double? = if (a.isNull(i)) null else a.getDouble(i)

    @Test fun `parseAntwort - contract json responses`() {
        val fx = JSONObject(Fixtures.text("docs/fixtures/cm-resolve/contract.json")).getJSONArray("responses")
        assertTrue(fx.length() >= 5)
        for (i in 0 until fx.length()) {
            val c = fx.getJSONObject(i)
            val name = c.getString("name")
            val json = if (c.has("raw")) c.getString("raw") else c.getJSONObject("body").toString()
            val a = CmResolveRepository.parseAntwort(json)
            if (c.isNull("expect")) { assertNull(name, a); continue }
            val e = c.getJSONObject("expect")
            assertNotNull(name, a); a!!
            assertEquals(name, e.getBoolean("ok"), a.ok)
            if (!a.ok) { assertEquals(name, e.getString("fehler"), a.fehler); continue }
            assertEquals(name, if (e.isNull("ab")) null else e.getDouble("ab"), a.ab)
            assertEquals(name, if (e.isNull("priceDate")) null else e.getString("priceDate"), a.priceDate)
            val erg = e.getJSONObject("ergebnisse")
            assertEquals(name, erg.keys().asSequence().toSet(), a.ergebnisse.keys)
            erg.keys().forEach { k ->
                val ids = erg.getJSONArray(k); assertEquals("$name $k", (0 until ids.length()).map { ids.getInt(it) }, a.ergebnisse[k]!!.cm)
            }
            val pr = e.getJSONObject("preise")
            assertEquals(name, pr.keys().asSequence().map { it.toInt() }.toSet(), a.preise.keys)
            pr.keys().forEach { k ->
                val p = pr.getJSONArray(k); assertEquals("$name $k", nullableDouble(p, 0) to nullableDouble(p, 1), a.preise[k.toInt()])
            }
        }
    }

    @Test fun `parseAntwort - status, how und Datum werden uebernommen`() {
        val body = JSONObject(Fixtures.text("docs/fixtures/cm-resolve/contract.json")).getJSONArray("responses").getJSONObject(0)
            .getJSONObject("body").toString()
        val a = CmResolveRepository.parseAntwort(body)!!
        assertEquals(LiveCm("resolved", "unique", listOf(102800)), a.ergebnisse["LOB-1|ultrarare"])
        assertEquals(LiveCm("ambiguous", null, listOf(741197, 741198)), a.ergebnisse["RA01-8|platinumsecretrare"])
        assertEquals(LiveCm("not_found", null, emptyList()), a.ergebnisse["XXXX-1|"])
        assertEquals("2026-11-03", a.indexDate)
        assertNull(a.fehler)
    }

    @Test fun `parseAntwort - ok kein Boolean, kein Objekt oder leer ergibt null`() {
        assertNull(CmResolveRepository.parseAntwort("""{"ok":"true"}"""))
        assertNull(CmResolveRepository.parseAntwort("[]"))
        assertNull(CmResolveRepository.parseAntwort(""))
        assertEquals("Live-Suche fehlgeschlagen.", CmResolveRepository.parseAntwort("""{"ok":false}""")!!.fehler)
    }

    // ---- requestBody ------------------------------------------------------------------------------------------------

    @Test fun `requestBody - Felder, name_en weggelassen, hoechstens 10`() {
        val o = JSONObject(CmResolveRepository.requestBody("89631139", "Blue-Eyes White Dragon",
            listOf("LOB-DE001" to "Ultra Rare", "RA01-DE008" to "")))
        assertEquals(1, o.getInt("v"))
        assertEquals("89631139", o.getString("card_id"))
        assertEquals("Blue-Eyes White Dragon", o.getString("name_en"))
        val p = o.getJSONArray("printings")
        assertEquals(2, p.length())
        assertEquals("LOB-DE001", p.getJSONObject(0).getString("set_code"))
        assertEquals("Ultra Rare", p.getJSONObject(0).getString("rarity"))
        assertEquals("", p.getJSONObject(1).getString("rarity"))

        assertFalse(JSONObject(CmResolveRepository.requestBody("1", null, listOf("LOB-DE001" to ""))).has("name_en"))
        assertFalse(JSONObject(CmResolveRepository.requestBody("1", "  ", listOf("LOB-DE001" to ""))).has("name_en"))
        val elf = (1..11).map { "LOB-DE%03d".format(it) to "Common" }
        assertEquals(10, JSONObject(CmResolveRepository.requestBody("1", null, elf)).getJSONArray("printings").length())
    }

    // ---- Aufruf ueber die Naht `senden` ---------------------------------------------------------------------------

    private val okBody = """{"ok":true,"v":1,"index_date":"2026-11-03","price_date":"2026-11-02",
        "card":{"name_en":"X","ab":0.09,"ab_products":3},
        "results":[{"set_code":"LOB-DE001","rarity":"Ultra Rare","code_key":"LOB-1","rarity_key":"ultrarare","status":"resolved",
          "how":"unique","reason":null,"cm":[102800],"cached":false}],
        "prices":{"102800":[12.5,9.0]}}"""
    private val bedarf = listOf("LOB-DE001" to "Ultra Rare")

    @Test fun `401 - anmelden, einmal wiederholen, Erfolg`() = runTest {
        CmResolveRepository.scope = backgroundScope
        val antworten = ArrayDeque(listOf(401 to """{"code":401,"message":"Invalid JWT"}""", 200 to okBody))
        var gesendet = 0; var angemeldet = 0
        CmResolveRepository.senden = { gesendet++; antworten.removeFirst() }
        CmResolveRepository.anmelden = { angemeldet++ }
        val a = CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertEquals(true, a?.ok)
        assertEquals(2, gesendet); assertEquals(1, angemeldet)
        assertEquals(LiveCm("resolved", "unique", listOf(102800)), CmResolveRepository.stand("1").ergebnisse["LOB-1|ultrarare"])
    }

    @Test fun `401 zweimal - Fehler, nichts gespeichert`() = runTest {
        CmResolveRepository.scope = backgroundScope
        var gesendet = 0
        CmResolveRepository.senden = { gesendet++; 401 to """{"code":401,"message":"Invalid JWT"}""" }
        CmResolveRepository.anmelden = { }
        val a = CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertTrue(a == null || !a.ok)
        assertEquals(2, gesendet)
        assertTrue(CmResolveRepository.stand("1").ergebnisse.isEmpty())
        assertEquals(setOf("LOB-1|ultrarare"), CmResolveRepository.fehlgeschlagen("1"))
    }

    @Test fun `546 ohne ok - Fehler ohne Anmeldung`() = runTest {
        CmResolveRepository.scope = backgroundScope
        var angemeldet = 0
        CmResolveRepository.senden = { 546 to """{"code":"WORKER_LIMIT","message":"limit"}""" }
        CmResolveRepository.anmelden = { angemeldet++ }
        val a = CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertNull(a)
        assertEquals(0, angemeldet)
        assertFalse(CmResolveRepository.bekannt("1", "LOB-1|ultrarare"))
        assertEquals(setOf("LOB-1|ultrarare"), CmResolveRepository.fehlgeschlagen("1"))
    }

    @Test fun `ok false bei HTTP 200 - Fehler`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { 200 to """{"ok":false,"code":"no_index","error":"Cardmarket-Index fehlt."}""" }
        val a = CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertEquals(false, a?.ok)
        assertEquals("Cardmarket-Index fehlt.", a?.fehler)
        assertFalse(CmResolveRepository.bekannt("1", "LOB-1|ultrarare"))
    }

    @Test fun `Ausnahme beim Senden (Timeout) - Fehler, wirft nicht`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { throw java.io.InterruptedIOException("timeout") }
        assertNull(CmResolveRepository.anfragen("1", "X", bedarf).await())
        assertEquals(setOf("LOB-1|ultrarare"), CmResolveRepository.fehlgeschlagen("1"))
    }

    @Test fun `ok true bei HTTP 500 - zaehlt als Erfolg`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { 500 to okBody }
        assertEquals(true, CmResolveRepository.anfragen("1", "X", bedarf).await()?.ok)
        assertTrue(CmResolveRepository.bekannt("1", "LOB-1|ultrarare"))
    }

    // ---- Sitzungsspeicher, laeuft, Sperre ---------------------------------------------------------------------------

    @Test fun `Sitzungsspeicher - Stand, bekannt, Preise zusammengefuehrt, not_found zaehlt`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { 200 to okBody }
        CmResolveRepository.anfragen("1", "X", bedarf).await()
        CmResolveRepository.senden = { 200 to """{"ok":true,"v":1,"index_date":"2026-11-03","price_date":"2026-11-03",
            "card":{"name_en":"X","ab":null,"ab_products":0},
            "results":[{"set_code":"XXXX-DE001","rarity":"","code_key":"XXXX-1","rarity_key":"","status":"not_found",
              "how":null,"reason":"no-expansion","cm":[],"cached":false}],"prices":{"5":[1.0,null]}}""" }
        CmResolveRepository.anfragen("1", "X", listOf("XXXX-DE001" to "")).await()
        val s = CmResolveRepository.stand("1")
        assertEquals(12.5, s.trend(102800)); assertEquals(9.0, s.low(102800))
        assertEquals(1.0, s.trend(5)); assertNull(s.low(5))
        assertEquals(0.09, s.ab)                  // null aus der zweiten Antwort verdraengt den bekannten Wert nicht
        assertEquals("2026-11-03", s.priceDate)
        assertTrue(CmResolveRepository.bekannt("1", "XXXX-1|"))
        assertEquals(LiveCm("not_found", null, emptyList()), s.ergebnisse["XXXX-1|"])
        assertFalse(CmResolveRepository.bekannt("2", "LOB-1|ultrarare"))
        assertEquals(CmResolveRepository.Stand.LEER, CmResolveRepository.stand("2"))
        assertTrue(CmResolveRepository.fehlgeschlagen("1").isEmpty())
    }

    @Test fun `laeuft - Schluessel waehrend der Anfrage, danach leer`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { delay(1_000); 200 to okBody }
        val v0 = CmResolveRepository.version.value
        val d = CmResolveRepository.anfragen("1", "X", bedarf + ("lob-de001" to "UR"))   // gleicher liveKey zaehlt einmal
        runCurrent()
        assertEquals(setOf("LOB-1|ultrarare"), CmResolveRepository.laeuft("1"))
        assertTrue(CmResolveRepository.laeuft("2").isEmpty())
        assertTrue(CmResolveRepository.version.value > v0)
        d.await()
        runCurrent()
        assertTrue(CmResolveRepository.laeuft("1").isEmpty())
    }

    @Test fun `Anfrage laeuft im eigenen Scope weiter, auch ohne Warten`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.senden = { delay(3_000); 200 to okBody }
        CmResolveRepository.anfragen("1", "X", bedarf)   // niemand wartet (Seite verlassen)
        advanceTimeBy(3_001); runCurrent()
        assertTrue(CmResolveRepository.bekannt("1", "LOB-1|ultrarare"))
    }

    @Test fun `bekannte und laufende Schluessel werden nicht erneut gesendet`() = runTest {
        CmResolveRepository.scope = backgroundScope
        val bodies = mutableListOf<String>()
        CmResolveRepository.senden = { bodies += it; delay(500); 200 to okBody }
        val a = CmResolveRepository.anfragen("1", "X", bedarf)
        runCurrent()
        val b = CmResolveRepository.anfragen("1", "X", bedarf)           // laeuft schon
        assertNull(b.await())
        a.await()
        val c = CmResolveRepository.anfragen("1", "X", bedarf)           // schon bekannt
        assertNull(c.await())
        assertEquals(1, bodies.size)
    }

    @Test fun `60-s-Sperre nach einem Fehler, injizierte Uhr`() = runTest {
        CmResolveRepository.scope = backgroundScope
        var uhr = 1_000_000L
        CmResolveRepository.jetzt = { uhr }
        CmResolveRepository.senden = { 503 to """{"ok":false,"code":"no_index","error":"Cardmarket-Index fehlt."}""" }
        assertFalse(CmResolveRepository.gesperrt("1"))
        CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertTrue(CmResolveRepository.gesperrt("1"))
        assertFalse(CmResolveRepository.gesperrt("2"))
        uhr += 59_999
        assertTrue(CmResolveRepository.gesperrt("1"))
        uhr += 1
        assertFalse(CmResolveRepository.gesperrt("1"))
        CmResolveRepository.senden = { 200 to okBody }
        CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertFalse(CmResolveRepository.gesperrt("1"))
        assertTrue(CmResolveRepository.fehlgeschlagen("1").isEmpty())
    }
    // Review-Nachtrag 2 (03.11.): Fehlerzustand und Sperre je Schluessel -- der Erfolg einer parallelen Anfrage loescht
    // weder den Fehler noch die Sperre einer anderen fehlgeschlagenen Anfrage derselben Karte.
    private val okBody2 = """{"ok":true,"v":1,"index_date":"2026-11-03","price_date":"2026-11-02",
        "card":{"name_en":"X","ab":0.09,"ab_products":3},
        "results":[{"set_code":"LOB-DE002","rarity":"Common","code_key":"LOB-2","rarity_key":"common","status":"resolved",
          "how":"unique","reason":null,"cm":[102802],"cached":false}],
        "prices":{"102802":[0.5,0.2]}}"""
    private val fehlerBody = """{"ok":false,"code":"no_index","error":"Cardmarket-Index fehlt."}"""

    @Test fun `ueberlappend - A gelingt nach Fehler von B, Fehler und Sperre von B bleiben`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.jetzt = { 1_000_000L }
        CmResolveRepository.senden = { body ->
            if ("LOB-DE001" in body) { delay(1_000); 200 to okBody } else { delay(100); 503 to fehlerBody }
        }
        val a = CmResolveRepository.anfragen("1", "X", bedarf)
        runCurrent()
        val b = CmResolveRepository.anfragen("1", "X", listOf("LOB-DE002" to "Common"))
        assertNotNull(b.await())
        assertEquals(setOf("LOB-2|common"), CmResolveRepository.fehlgeschlagen("1"))
        assertTrue(CmResolveRepository.gesperrt("1"))
        a.await()
        assertTrue(CmResolveRepository.bekannt("1", "LOB-1|ultrarare"))
        assertEquals(setOf("LOB-2|common"), CmResolveRepository.fehlgeschlagen("1"))
        assertTrue(CmResolveRepository.gesperrt("1"))
    }

    @Test fun `ueberlappend - A scheitert, danach gelingt B, Fehler von A bleibt`() = runTest {
        CmResolveRepository.scope = backgroundScope
        CmResolveRepository.jetzt = { 1_000_000L }
        CmResolveRepository.senden = { body ->
            if ("LOB-DE001" in body) { delay(500); 503 to fehlerBody } else { delay(1_000); 200 to okBody2 }
        }
        val a = CmResolveRepository.anfragen("1", "X", bedarf)
        runCurrent()
        val b = CmResolveRepository.anfragen("1", "X", listOf("LOB-DE002" to "Common"))
        a.await(); b.await()
        assertTrue(CmResolveRepository.bekannt("1", "LOB-2|common"))
        assertEquals(setOf("LOB-1|ultrarare"), CmResolveRepository.fehlgeschlagen("1"))
        assertTrue(CmResolveRepository.gesperrt("1"))
    }

    @Test fun `zwei Fehler sammeln Schluessel, Erfolg fuer alle hebt Fehler und Sperre auf`() = runTest {
        CmResolveRepository.scope = backgroundScope
        var uhr = 1_000_000L
        CmResolveRepository.jetzt = { uhr }
        CmResolveRepository.senden = { body -> if ("LOB-DE001" in body) { delay(500); 503 to fehlerBody } else { delay(1_000); 503 to fehlerBody } }
        val a = CmResolveRepository.anfragen("1", "X", bedarf)
        runCurrent()
        val b = CmResolveRepository.anfragen("1", "X", listOf("LOB-DE002" to "Common"))
        a.await(); b.await()
        assertEquals(setOf("LOB-1|ultrarare", "LOB-2|common"), CmResolveRepository.fehlgeschlagen("1"))
        uhr += CmResolveRepository.SPERRE_MS
        CmResolveRepository.senden = { 200 to okBody }
        CmResolveRepository.anfragen("1", "X", bedarf).await()
        assertEquals(setOf("LOB-2|common"), CmResolveRepository.fehlgeschlagen("1"))   // nur die Schluessel dieser Anfrage
        CmResolveRepository.senden = { 200 to okBody2 }
        CmResolveRepository.anfragen("1", "X", listOf("LOB-DE002" to "Common")).await()
        assertTrue(CmResolveRepository.fehlgeschlagen("1").isEmpty())
        assertFalse(CmResolveRepository.gesperrt("1"))
    }
}
