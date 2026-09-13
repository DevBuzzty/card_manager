package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Coalescer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ein Lauf gleichzeitig; Anforderungen waehrend eines Laufs verschmelzen zu genau einem weiteren (Spec §4.3). */
@OptIn(ExperimentalCoroutinesApi::class)
class CoalescerTest {

    @Test fun `ein Auftrag laeuft genau einmal`() = runTest {
        var runs = 0
        val c = Coalescer(this) { runs++ }
        c.request()
        advanceUntilIdle()
        assertEquals(1, runs)
    }

    @Test fun `Auftraege waehrend eines Laufs fuehren zu genau einem weiteren`() = runTest {
        var runs = 0
        val gate = CompletableDeferred<Unit>()
        val c = Coalescer(this) { runs++; if (runs == 1) gate.await() }
        c.request()
        advanceUntilIdle()
        repeat(3) { c.request() }
        advanceUntilIdle()
        assertEquals(1, runs)
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(2, runs)
    }

    @Test fun `nie zwei Laeufe gleichzeitig`() = runTest {
        var active = 0
        var maxActive = 0
        val gates = List(3) { CompletableDeferred<Unit>() }
        var runs = 0
        val c = Coalescer(this) {
            active++; maxActive = maxOf(maxActive, active)
            gates[runs++].await()
            active--
        }
        c.request(); advanceUntilIdle()
        c.request(); advanceUntilIdle()
        gates.forEach { it.complete(Unit) }
        advanceUntilIdle()
        assertEquals(1, maxActive)
    }

    @Test fun `requestAndWait wartet auf einen Lauf, der danach begann`() = runTest {
        var runs = 0
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        val c = Coalescer(this) { runs++; if (runs == 1) first.await() else second.await() }
        c.request()
        advanceUntilIdle()
        var done = false
        launch { c.requestAndWait(); done = true }
        advanceUntilIdle()
        first.complete(Unit)
        advanceUntilIdle()
        assertFalse("der erste Lauf begann vor dem Aufruf und zaehlt nicht", done)
        second.complete(Unit)
        advanceUntilIdle()
        assertTrue(done)
        assertEquals(2, runs)
    }

    @Test fun `ein werfender Lauf haelt Wartende nicht fest`() = runTest {
        val c = Coalescer(this) { throw IllegalStateException("kaputt") }
        var done = false
        launch { c.requestAndWait(); done = true }
        advanceUntilIdle()
        assertTrue(done)
    }
}
