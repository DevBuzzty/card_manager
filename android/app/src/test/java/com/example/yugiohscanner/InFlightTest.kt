package com.example.yugiohscanner

import com.example.yugiohscanner.ui.InFlight
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec E2 Task 8 Fix 1: Doppel-Tipp darf einen laufenden Vorgang nicht zweimal starten (Review-Fund). */
class InFlightTest {
    @Test fun `zweiter tryStart waehrend eines Laufs liefert false, nach finish wieder true`() {
        val gate = InFlight()
        assertTrue(gate.tryStart())
        assertFalse(gate.tryStart())
        gate.finish()
        assertTrue(gate.tryStart())
    }
}
