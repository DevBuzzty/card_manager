package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ForegroundTick
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Spec G2 §7: beim Eintritt in den Vordergrund werden die Preis-Alarme einmal nachgeladen, der
 * 10-s-Abgleich laeuft weiter. Bewusst im Test-Scope (nicht backgroundScope) gestartet und mit
 * advanceTimeBy/runCurrent getrieben -- advanceUntilIdle wuerde an der Endlosschleife haengen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ForegroundTickTest {
    @Test fun `Eintritt laedt einmal, der Takt laeuft weiter`() = runTest {
        var enters = 0
        var ticks = 0
        val job = launch { ForegroundTick.run(onEnter = { enters++ }, tick = { ticks++ }) }
        runCurrent()
        assertEquals(1, enters)
        assertEquals(1, ticks)
        advanceTimeBy(10_000)
        runCurrent()
        assertEquals(1, enters)
        assertEquals(2, ticks)
        job.cancel()
    }

    @Test fun `jede Rueckkehr in den Vordergrund laedt erneut`() = runTest {
        var enters = 0
        repeat(2) {
            val job = launch { ForegroundTick.run(onEnter = { enters++ }, tick = {}) }
            runCurrent()
            job.cancel()
        }
        assertEquals(2, enters)
    }
}
