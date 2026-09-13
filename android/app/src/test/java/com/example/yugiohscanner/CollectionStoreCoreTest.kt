package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionStoreCore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Fetched
import com.example.yugiohscanner.cloud.StoreSource
import com.example.yugiohscanner.cloud.StoreState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class CollectionStoreCoreTest {

    private val t0 = "2026-09-13T12:00:00+00:00"

    private fun card(id: String) = CardRow(id = id, setCode = "LOB-DE001", language = "DE", name = "n",
        imageUrl = null, rarity = "Common", quantity = 1, price = 1.0, updatedAt = t0)

    private fun copy(id: String, deleted: Boolean = false, updatedAt: String = t0) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = null, note = null, updatedAt = updatedAt,
    )

    private fun container(id: String) = ContainerRow(containerId = id, name = id, kind = "box",
        pocketsPerPage = null, color = null, sortOrder = 0, updatedAt = t0)

    /**
     * Nachgebaute Netzquelle: Antworten je Aufruf austauschbar, jeder Aufruf mitgeschrieben.
     * `serverTime` ist die Serverzeit, die jede Antwort mitliefert (HTTP-`Date`), `null` = kein Header.
     */
    private class FakeSource : StoreSource {
        var cards: suspend (String?) -> List<CardRow> = { emptyList() }
        var copies: suspend (String?) -> List<CopyRow> = { emptyList() }
        var containers: suspend (String?) -> List<ContainerRow> = { emptyList() }
        var serverTime: String? = null
        val calls = mutableListOf<String>()
        override suspend fun loadCards(changedSince: String?) =
            Fetched(cards(changedSince), serverTime).also { calls += "cards:$changedSince" }
        override suspend fun loadCopies(changedSince: String?) =
            Fetched(copies(changedSince), serverTime).also { calls += "copies:$changedSince" }
        override suspend fun loadContainers(changedSince: String?) =
            Fetched(containers(changedSince), serverTime).also { calls += "containers:$changedSince" }
    }

    private fun ready(store: CollectionStoreCore) = store.state.value as StoreState.Ready

    @Test fun `Ready erst, wenn alle drei Tabellen da sind`() = runTest {
        val src = FakeSource()
        val gate = CompletableDeferred<List<CopyRow>>()
        src.cards = { listOf(card("1")) }
        src.copies = { gate.await() }
        src.containers = { listOf(container("b")) }
        val store = CollectionStoreCore(src, backgroundScope) { Instant.EPOCH }
        launch { store.loadInitial() }
        advanceUntilIdle()
        assertEquals(StoreState.Loading, store.state.value)
        gate.complete(listOf(copy("a")))
        advanceUntilIdle()
        assertEquals(listOf("a"), ready(store).copies.map { it.copyId })
        assertEquals(listOf("1"), ready(store).cards.map { it.id })
        assertEquals(listOf("b"), ready(store).containers.map { it.containerId })
    }

    @Test fun `scheitert eine Tabelle beim ersten Laden, bleibt nichts halb`() = runTest {
        val src = FakeSource()
        src.copies = { throw RuntimeException("kaputt") }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        assertEquals(StoreState.Failed("kaputt"), store.state.value)
    }

    @Test fun `Delta fragt ab Stichtag minus 60 Sekunden, leere Tabelle ab 1970`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.calls.clear()
        store.awaitSync()
        assertTrue(src.calls.contains("copies:2026-09-13T11:59:00Z"))
        assertTrue(src.calls.contains("cards:1970-01-01T00:00:00Z"))
    }

    @Test fun `Delta arbeitet Aenderungen und Loeschungen ein`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a"), copy("b")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.copies = { listOf(copy("b", deleted = true), copy("c", updatedAt = "2026-09-13T12:05:00+00:00")) }
        store.awaitSync()
        assertEquals(listOf("a", "c"), ready(store).copies.map { it.copyId })
        src.calls.clear()
        store.awaitSync()
        assertTrue("Stichtag rueckt auf den spaetesten gelieferten Zeitpunkt", src.calls.contains("copies:2026-09-13T12:04:00Z"))
    }

    @Test fun `Serverzeit hebt die Untergrenze, auch ohne neuere Zeilen`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }                 // Stichtag 12:00:00
        src.serverTime = "2026-09-13T12:30:00Z"
        // Foreground-Bereich: nur so haengt der Lauf nicht allein an backgroundScope (siehe CoalescerTest).
        val store = CollectionStoreCore(src, this)
        store.loadInitial()

        // Erster Abgleich: schon das vollstaendige Laden hat serverStart gesetzt.
        src.calls.clear()
        src.copies = { emptyList() }                       // keine neueren Zeilen
        src.serverTime = "2026-09-13T12:40:00Z"
        store.awaitSync()
        assertTrue("Laden setzt serverStart: ${src.calls}", src.calls.contains("copies:2026-09-13T12:29:00Z"))
        assertTrue("auch fuer die leere Tabelle: ${src.calls}", src.calls.contains("cards:2026-09-13T12:29:00Z"))

        // Zweiter Abgleich: das Delta ohne Zeilen hat serverStart auf 12:40 vorgezogen -- ohne die
        // Regel fragte er weiter ab Stichtag − 60 s (11:59) und laede denselben Stapel endlos neu.
        src.calls.clear()
        src.serverTime = null                              // Header fehlt: alter serverStart bleibt
        store.awaitSync()
        assertTrue("Delta setzt serverStart: ${src.calls}", src.calls.contains("copies:2026-09-13T12:39:00Z"))

        // Gescheiterter Abgleich aendert serverStart nicht.
        src.copies = { throw RuntimeException("offline") }
        src.serverTime = "2026-09-13T13:00:00Z"
        store.awaitSync()
        src.copies = { emptyList() }
        src.calls.clear()
        store.awaitSync()
        assertTrue("Fehler laesst serverStart stehen: ${src.calls}", src.calls.contains("copies:2026-09-13T12:39:00Z"))
    }

    @Test fun `Abgleich ohne Aenderung laesst den Datenzustand unberuehrt`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        val before = store.state.value
        store.awaitSync()
        assertSame(before, store.state.value)
    }

    @Test fun `Abgleich-Fehler behaelt Daten und Stichtag`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope) { Instant.parse("2026-09-13T12:00:00Z") }
        store.loadInitial()
        val before = store.state.value
        src.copies = { throw RuntimeException("offline") }
        store.awaitSync()
        assertSame(before, store.state.value)
        assertTrue(store.sync.value.failing)
        assertEquals(Instant.parse("2026-09-13T12:00:00Z"), store.sync.value.lastSuccess)
        src.copies = { emptyList() }
        src.calls.clear()
        store.awaitSync()
        assertTrue("Stichtag unveraendert", src.calls.contains("copies:2026-09-13T11:59:00Z"))
        assertFalse(store.sync.value.failing)
    }

    @Test fun `clear waehrend eines Abgleichs verwirft dessen Ergebnis, auch wenn danach neu geladen wird`() = runTest {
        val src = FakeSource()
        src.copies = { listOf(copy("a")) }
        // Foreground statt backgroundScope: nur so treibt advanceUntilIdle() den Lauf wirklich an
        // (siehe CoalescerTest) -- sonst waere dieser Test vacuous, weil requestSync() nie startet.
        val store = CollectionStoreCore(src, this)
        store.loadInitial()
        val gate = CompletableDeferred<Unit>()
        // Ein spaeter gelieferter Zeitpunkt: wuerde das verworfene Ergebnis den Stichtag doch
        // fortschreiben, waere das am naechsten Abgleich sichtbar (siehe unten).
        src.copies = { gate.await(); listOf(copy("b", updatedAt = "2026-09-13T12:10:00+00:00")) }
        var syncDone = false
        launch { store.awaitSync(); syncDone = true }
        advanceUntilIdle()
        assertFalse("der Lauf haengt am Gatter, bevor irgendetwas ihn abbricht", syncDone)

        // clear() waehrend der Lauf noch unterwegs ist, dann sofort neu laden: der Speicher ist
        // wieder Ready, bevor der alte Lauf zurueckkehrt -- genau der Fall, den NUR die Generation
        // abfaengt (die beiden anderen fruehen Ausstiege in runDelta greifen hier nicht, weil der
        // Zustand zu dem Zeitpunkt erneut Ready ist).
        store.clear()
        src.copies = { listOf(copy("c")) }
        store.loadInitial()
        assertEquals(listOf("c"), ready(store).copies.map { it.copyId })

        gate.complete(Unit)
        advanceUntilIdle()

        assertTrue("der alte Lauf muss zurueckgekehrt sein, sonst haengt requestAndWait", syncDone)
        assertEquals(
            "das Ergebnis des alten Laufs (\"b\") darf die neue Ready-Ladung nicht ueberschreiben",
            listOf("c"),
            ready(store).copies.map { it.copyId },
        )

        // Ohne die Generation-Pruefung haette der alte Lauf den Stichtag auf "b"s (spaeteren)
        // Zeitpunkt vorgezogen; der naechste Abgleich fraegt dann ab dem FALSCHEN Stichtag.
        src.copies = { emptyList() }
        src.calls.clear()
        store.awaitSync()
        assertTrue(
            "Stichtag kommt von der neuen Ladung (\"c\"), nicht vom verworfenen alten Lauf (\"b\")",
            src.calls.contains("copies:2026-09-13T11:59:00Z"),
        )
    }

    @Test fun `clear waehrend des ersten Ladens verwirft es`() = runTest {
        val src = FakeSource()
        val gate = CompletableDeferred<Unit>()
        src.copies = { gate.await(); listOf(copy("a")) }
        val store = CollectionStoreCore(src, backgroundScope)
        launch { store.loadInitial() }
        advanceUntilIdle()
        store.clear()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(StoreState.Empty, store.state.value)
    }

    @Test fun `ohne Ready fragt der Abgleich nichts ab`() = runTest {
        val src = FakeSource()
        val store = CollectionStoreCore(src, backgroundScope)
        store.awaitSync()
        assertEquals(emptyList<String>(), src.calls)
    }

    @Test fun `zweites loadInitial waehrend Ready laedt nicht erneut`() = runTest {
        val src = FakeSource()
        val store = CollectionStoreCore(src, backgroundScope)
        store.loadInitial()
        src.calls.clear()
        store.loadInitial()
        assertEquals(emptyList<String>(), src.calls)
    }
}
