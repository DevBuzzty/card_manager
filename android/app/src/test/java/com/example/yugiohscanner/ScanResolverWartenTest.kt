package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanSprache
import com.example.yugiohscanner.ui.ResolvedScan
import com.example.yugiohscanner.ui.ScanResolver
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** Spec 2026-11-03 §4.2 / §10 -- Wartezeit Einzel 4 s, Stapel 1,5 s, Rueckfall, `verbessert`; virtuelle Zeit. */
@OptIn(ExperimentalCoroutinesApi::class)
class ScanResolverWartenTest {
    private val enDruck = CatalogPrinting("LOB-EN005", "Ultra Rare", "EN", false, cm = listOf(1))
    private val karte = CatalogCard(
        id = "46986414", nameDe = "Schwarzer Magier", nameEn = "Dark Magician", type = "Normal", descDe = "", atk = 2500,
        def = 2100, level = 7, race = null, attribute = null, image = "", imageSmall = "", printings = listOf(enDruck),
    )
    private val katalogSets = listOf(SetOption("LOB-EN005", "Ultra Rare", 0.0, "EN"))
    private val kr = SetOption("LOB-KR005", "Ultra Rare", 0.0, "KR")
    private val netzSets = listOf(SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE"), SetOption("LOB-EN005", "Ultra Rare", 0.0, "EN"))
    private val zeilen = mutableListOf<String>()
    private var geteiltAufrufe = 0
    private var letzter: Deferred<List<SetOption>>? = null

    private lateinit var katalog0: (String) -> CatalogCard?
    private lateinit var suche0: suspend (String) -> CardRow?
    private lateinit var geteilt0: (String) -> Deferred<List<SetOption>>
    private lateinit var kr0: (String) -> List<SetOption>
    private lateinit var protokoll0: (String, String) -> Unit
    private lateinit var io0: CoroutineDispatcher
    private lateinit var rechnen0: CoroutineDispatcher
    private lateinit var hintergrund0: CoroutineScope
    private lateinit var jetzt0: () -> Long

    @Before fun setUp() {
        katalog0 = ScanResolver.katalogKarte; suche0 = ScanResolver.sucheKarte; geteilt0 = ScanResolver.geteilt
        kr0 = ScanResolver.krAusCache; protokoll0 = ScanResolver.protokoll; io0 = ScanResolver.io
        rechnen0 = ScanResolver.rechnen; hintergrund0 = ScanResolver.hintergrund; jetzt0 = ScanResolver.jetztMs
        ScanSprache.fest = null
    }

    @After fun tearDown() {
        ScanResolver.katalogKarte = katalog0; ScanResolver.sucheKarte = suche0; ScanResolver.geteilt = geteilt0
        ScanResolver.krAusCache = kr0; ScanResolver.protokoll = protokoll0; ScanResolver.io = io0
        ScanResolver.rechnen = rechnen0; ScanResolver.hintergrund = hintergrund0; ScanResolver.jetztMs = jetzt0
        ScanSprache.fest = null
    }

    /** Netz liefert [netz] nach [dauerMs]; [fehler] wirft stattdessen. */
    private fun TestScope.naehte(dauerMs: Long, netz: List<SetOption>, fehler: Boolean = false, k: CatalogCard = karte) {
        val disp = StandardTestDispatcher(testScheduler)
        ScanResolver.katalogKarte = { k }
        ScanResolver.sucheKarte = { error("Suche darf nicht laufen") }
        ScanResolver.krAusCache = { listOf(kr) }
        ScanResolver.protokoll = { t, m -> zeilen += "$t $m" }
        ScanResolver.io = disp; ScanResolver.rechnen = disp
        ScanResolver.hintergrund = backgroundScope
        ScanResolver.jetztMs = { testScheduler.currentTime }
        ScanResolver.geteilt = {
            geteiltAufrufe++
            // CompletableDeferred statt async: ein werfendes Kind von backgroundScope liesse den Test scheitern.
            val c = CompletableDeferred<List<SetOption>>()
            backgroundScope.launch { delay(dauerMs); if (fehler) c.completeExceptionally(IOException("offline")) else c.complete(netz) }
            letzter = c
            c
        }
    }

    private suspend fun los(warten: Long = ScanResolver.NETZ_WARTEN_STAPEL_MS, nachrechnen: Boolean = false): ResolvedScan? =
        ScanResolver.resolve("46986414", listOf("LOB-DE005"), listOf("LOB-DE005"), emptyList(), "unlimited", warten, nachrechnen)

    @Test fun `Einzelmodus wartet bis 4 s auf das Netz`() = runTest {
        naehte(3_000, netzSets)
        val r = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true)!!
        assertEquals(netzSets, r.knownSets)
        assertNull(r.verbessert)                               // kein Rueckfall -> nichts nachzurechnen
        assertEquals(1, geteiltAufrufe)
        assertTrue(zeilen.contains("Drucke pc=46986414 Netz ok n=2 dauer=3000ms"))
    }

    @Test fun `Stapel wartet 1,5 s und faellt dann wirklich auf Katalogdrucke zurueck`() = runTest {
        naehte(3_000, netzSets)
        val r = los()!!
        assertEquals(1_500L, testScheduler.currentTime)
        assertEquals(katalogSets + kr, r.knownSets)
        assertNull(r.verbessert)                               // Stapel: ohne nachrechnen
        assertTrue(zeilen.contains("Drucke pc=46986414 Netz > 1500ms dauer=1500ms, Katalog-Drucke genutzt"))
        assertEquals(1, geteiltAufrufe)                        // kein zweiter Abruf
    }

    @Test fun `Einzelmodus faellt nach 4 s zurueck und rechnet mit den Netzdrucken nach`() = runTest {
        naehte(6_000, netzSets)
        val r = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true)!!
        assertEquals(4_000L, testScheduler.currentTime)
        assertEquals(katalogSets + kr, r.knownSets)
        assertTrue(zeilen.contains("Drucke pc=46986414 Netz > 4000ms dauer=4000ms, Katalog-Drucke genutzt"))
        val neu = r.verbessert!!.await()
        assertNotNull(neu)
        assertEquals(netzSets, neu!!.knownSets)
        assertSame(r.base, neu.base)
        assertEquals(r.readSetCode, neu.readSetCode)
        assertNull(neu.verbessert)
        assertEquals("LOB-DE005", neu.match.selected?.setCode)
        assertTrue(zeilen.any { it.startsWith("ScanDecision stage=nach pc=46986414") })
        assertEquals(1, geteiltAufrufe)
    }

    @Test fun `gleiche Schluesselmenge ergibt null`() = runTest {
        naehte(6_000, katalogSets + kr)
        val r = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true)!!
        assertNull(r.verbessert!!.await())
        assertFalse(zeilen.any { it.contains("stage=nach") })
    }

    @Test fun `leere Netzantwort ergibt Katalogdrucke`() = runTest {
        naehte(200, emptyList())
        val r = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true)!!
        assertEquals(katalogSets + kr, r.knownSets)
        assertTrue(zeilen.contains("Drucke pc=46986414 Netz leer dauer=200ms, Katalog-Drucke genutzt"))
        assertNull(r.verbessert!!.await())                     // Rueckfall griff, Netz brachte nichts Neues
    }

    @Test fun `Netzfehler ergibt Katalogdrucke`() = runTest {
        naehte(200, netzSets, fehler = true)
        val r = los()!!
        assertEquals(katalogSets + kr, r.knownSets)
        assertTrue(zeilen.contains("Drucke pc=46986414 Netz leer dauer=200ms, Katalog-Drucke genutzt"))
    }

    @Test fun `Abbruch des Aufrufers wird weitergereicht, kein Rueckfall`() = runTest {
        naehte(6_000, netzSets)
        var erg: ResolvedScan? = null
        var fertig = false
        val job = launch { erg = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true); fertig = true }
        advanceTimeBy(1_000); runCurrent()
        job.cancel()
        advanceTimeBy(10_000); runCurrent()
        assertTrue(job.isCancelled)
        assertFalse(fertig); assertNull(erg)
        assertFalse(zeilen.any { it.contains("Katalog-Drucke genutzt") })
        assertTrue(letzter!!.isCompleted); assertFalse(letzter!!.isCancelled)   // der geteilte Abruf lief zu Ende
    }

    @Test fun `verifizierter Katalogblock fragt das Netz nicht`() = runTest {
        val verifiziert = karte.copy(printings = listOf(CatalogPrinting("LOB-DE005", "Ultra Rare", "DE", true)))
        naehte(0, netzSets, k = verifiziert)
        val r = los(ScanResolver.NETZ_WARTEN_EINZEL_MS, nachrechnen = true)!!
        assertEquals(0, geteiltAufrufe)
        assertEquals(listOf(SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE", verified = true), kr), r.knownSets)
        assertNull(r.verbessert)
    }
}
