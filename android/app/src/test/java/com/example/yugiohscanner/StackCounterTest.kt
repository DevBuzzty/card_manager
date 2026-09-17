package com.example.yugiohscanner

import com.example.yugiohscanner.ml.StackCounter
import org.junit.Assert.assertEquals
import org.junit.Test

class StackCounterTest {

    @Test fun `Bestaetigung ohne Einwurf zaehlt nicht`() {
        assertEquals(0, StackCounter().claim(1_000))
    }

    @Test fun `ein Einwurf wird genau einmal eingeloest`() {
        val c = StackCounter()
        c.einwurf(1, 1_000)
        assertEquals(1, c.claim(2_000))
        assertEquals(0, c.claim(2_500))
    }

    @Test fun `spaet erkannte Karte bekommt alle offenen Einwuerfe`() {
        // Messung 1, ~86,7 s: Karte eingeworfen, nicht erkannt; naechste Karte ~93,2 s, Bestaetigung ~94,5 s.
        val c = StackCounter()
        c.einwurf(1, 86_660)
        c.einwurf(1, 93_160)
        assertEquals(2, c.claim(94_530))
    }

    @Test fun `offene Einwuerfe verfallen nach 15 s ohne Bestaetigung`() {
        val c = StackCounter()
        c.einwurf(1, 0)
        assertEquals(0, c.claim(15_001))
    }
}
