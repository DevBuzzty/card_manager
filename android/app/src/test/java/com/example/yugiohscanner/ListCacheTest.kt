package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListCache
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Kleine Listen ohne updated_at: sofort den letzten Stand zeigen, im Hintergrund voll neu laden (Spec §8). */
@OptIn(ExperimentalCoroutinesApi::class)
class ListCacheTest {

    @Test fun `refreshAndWait laedt und setzt den Wert`() = runTest {
        val cache = ListCache(this) { listOf("a") }
        cache.refreshAndWait()
        assertEquals(listOf("a"), cache.state.value.value)
        assertFalse(cache.state.value.loading)
    }

    @Test fun `waehrend des Neuladens bleibt der alte Wert sichtbar`() = runTest {
        var n = 0
        val gate = CompletableDeferred<Unit>()
        val cache = ListCache(this) { n++; if (n == 2) gate.await(); listOf("v$n") }
        cache.refreshAndWait()
        cache.refresh()
        advanceUntilIdle()
        assertEquals(listOf("v1"), cache.state.value.value)
        assertTrue(cache.state.value.loading)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("v2"), cache.state.value.value)
    }

    @Test fun `Fehler behaelt den alten Wert und meldet sich`() = runTest {
        var fail = false
        val cache = ListCache(this) { if (fail) throw RuntimeException("offline") else listOf("a") }
        cache.refreshAndWait()
        fail = true
        cache.refreshAndWait()
        assertEquals(listOf("a"), cache.state.value.value)
        assertEquals("offline", cache.state.value.error)
        fail = false
        cache.refreshAndWait()
        assertNull(cache.state.value.error)
    }

    @Test fun `ensureLoaded laedt nur beim ersten Mal`() = runTest {
        var n = 0
        val cache = ListCache(this) { n++; listOf("a") }
        cache.ensureLoaded(); advanceUntilIdle()
        cache.ensureLoaded(); advanceUntilIdle()
        assertEquals(1, n)
    }

    @Test fun `update aendert den Wert ohne zu laden`() = runTest {
        var n = 0
        val cache = ListCache(this) { n++; listOf("a", "b") }
        cache.refreshAndWait()
        cache.update { it - "a" }
        assertEquals(listOf("b"), cache.state.value.value)
        assertEquals(1, n)
    }

    @Test fun `clear waehrend des Ladens verwirft das Ergebnis`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val cache = ListCache(this) { gate.await(); listOf("alt") }
        cache.refresh()
        advanceUntilIdle()
        cache.clear()
        gate.complete(Unit)
        advanceUntilIdle()
        assertNull(cache.state.value.value)
    }

    @Test fun `refreshIfStale laedt beim ersten Mal und dann erst nach Ablauf`() = runTest {
        var n = 0
        var now = 1_000L
        val cache = ListCache(this, clock = { now }) { n++; listOf("v$n") }
        cache.refreshIfStale(60_000); advanceUntilIdle()
        assertEquals(1, n)
        now += 59_999
        cache.refreshIfStale(60_000); advanceUntilIdle()
        assertEquals(1, n)
        now += 1
        cache.refreshIfStale(60_000); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf("v2"), cache.state.value.value)
    }

    @Test fun `refreshIfStale versucht es nach einem Fehler beim ersten Laden sofort wieder`() = runTest {
        var n = 0
        val cache = ListCache(this, clock = { 0L }) { n++; if (n == 1) throw RuntimeException("offline") else listOf("a") }
        cache.refreshIfStale(); advanceUntilIdle()
        assertNull(cache.state.value.value)
        cache.refreshIfStale(); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf("a"), cache.state.value.value)
    }

    @Test fun `ein Fehler nach einem Erfolg verlaengert die Frische nicht`() = runTest {
        var n = 0
        var now = 0L
        val cache = ListCache(this, clock = { now }) { n++; if (n == 2) throw RuntimeException("offline") else listOf("v$n") }
        cache.refreshAndWait()                  // Erfolg bei 0
        now = 60_000
        cache.refreshIfStale(60_000); advanceUntilIdle()   // Fehler
        cache.refreshIfStale(60_000); advanceUntilIdle()   // weiterhin alt -> neuer Versuch
        assertEquals(3, n)
        assertEquals(listOf("v3"), cache.state.value.value)
    }

    @Test fun `nach clear gilt der Stand nicht mehr als frisch`() = runTest {
        var n = 0
        val cache = ListCache(this, clock = { 0L }) { n++; listOf("a") }
        cache.refreshAndWait()
        cache.clear()
        cache.refreshIfStale(); advanceUntilIdle()
        assertEquals(2, n)
    }
}
