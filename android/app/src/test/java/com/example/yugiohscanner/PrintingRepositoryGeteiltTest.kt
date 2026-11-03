package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetOption
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** Spec 2026-11-03 §4.1 / §10 -- ein geteilter Abruf je Passcode, in virtueller Zeit. */
@OptIn(ExperimentalCoroutinesApi::class)
class PrintingRepositoryGeteiltTest {
    private val opt = SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE")
    private val zeilen = mutableListOf<String>()
    private lateinit var abruf0: suspend (String) -> List<SetOption>
    private lateinit var scope0: CoroutineScope
    private lateinit var protokoll0: (String, String) -> Unit
    private lateinit var jetzt0: () -> Long

    @Before fun setUp() {
        abruf0 = PrintingRepository.abruf; scope0 = PrintingRepository.scope
        protokoll0 = PrintingRepository.protokoll; jetzt0 = PrintingRepository.jetztMs
        PrintingRepository.protokoll = { t, m -> zeilen += "$t $m" }
        PrintingRepository.laufend.clear()
    }

    @After fun tearDown() {
        PrintingRepository.abruf = abruf0; PrintingRepository.scope = scope0
        PrintingRepository.protokoll = protokoll0; PrintingRepository.jetztMs = jetzt0
        PrintingRepository.laufend.clear()
    }

    @Test fun `zwei gleichzeitige Aufrufe teilen einen Abruf`() = runTest {
        var n = 0
        PrintingRepository.scope = backgroundScope
        PrintingRepository.jetztMs = { testScheduler.currentTime }
        PrintingRepository.abruf = { n++; delay(2_000); listOf(opt) }
        val a = PrintingRepository.fetchAllSetsGeteilt("1")
        val b = PrintingRepository.fetchAllSetsGeteilt("1")
        assertSame(a, b)
        assertEquals(listOf(opt), a.await())
        assertEquals(listOf(opt), b.await())
        assertEquals(1, n)
        runCurrent()
        assertTrue(PrintingRepository.laufend.isEmpty())
        assertEquals(listOf("Drucke pc=1 geteilt n=1 dauer=2000ms"), zeilen)
    }

    @Test fun `sofort fertiger Abruf hinterlaesst keinen Eintrag`() = runTest {
        var n = 0
        PrintingRepository.scope = backgroundScope
        PrintingRepository.abruf = { n++; listOf(opt) }
        val a = PrintingRepository.fetchAllSetsGeteilt("2")
        assertEquals(listOf(opt), a.await())
        runCurrent()
        assertTrue(PrintingRepository.laufend.isEmpty())
        val b = PrintingRepository.fetchAllSetsGeteilt("2")
        assertNotSame(a, b)
        b.await()
        assertEquals(2, n)
    }

    @Test fun `nach einem Fehler leere Liste, der naechste Aufruf startet neu`() = runTest {
        var n = 0
        PrintingRepository.scope = backgroundScope
        PrintingRepository.abruf = { n++; if (n == 1) throw IOException("offline") else listOf(opt) }
        assertEquals(emptyList<SetOption>(), PrintingRepository.fetchAllSetsGeteilt("3").await())
        runCurrent()
        assertTrue(PrintingRepository.laufend.isEmpty())
        assertEquals(listOf(opt), PrintingRepository.fetchAllSetsGeteilt("3").await())
        assertEquals(2, n)
    }

    @Test fun `Frist um await kehrt rechtzeitig zurueck, der Abruf laeuft weiter`() = runTest {
        PrintingRepository.scope = backgroundScope
        PrintingRepository.abruf = { delay(5_000); listOf(opt) }
        val d = PrintingRepository.fetchAllSetsGeteilt("4")
        val r = withTimeoutOrNull(1_500) { d.await() }
        assertNull(r)
        assertEquals(1_500L, testScheduler.currentTime)
        assertTrue(d.isActive)                               // Warten abgebrochen, nicht der Abruf
        assertSame(d, PrintingRepository.laufend["4"])
        advanceTimeBy(4_000); runCurrent()
        assertTrue(d.isCompleted); assertFalse(d.isCancelled)
        assertEquals(listOf(opt), d.await())
        assertTrue(PrintingRepository.laufend.isEmpty())
    }

    @Test fun `Client hat eine Gesamtfrist von 10 s`() {
        assertEquals(10_000, PrintingRepository.client.callTimeoutMillis)
    }
}
