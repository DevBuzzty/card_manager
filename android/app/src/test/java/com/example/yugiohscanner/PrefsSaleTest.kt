package com.example.yugiohscanner

import org.junit.Assert.assertEquals
import org.junit.Test

/** Task 13: Prefs.suggestionFor -- reine Verbindung zu SalesMath ohne Context. */
class PrefsSaleTest {
    @Test fun `Vorschlag mit Standardwerten bei fehlenden Einstellungen`() {
        assertEquals(190L, Prefs.suggestionFor(200L, null, null))
        assertEquals(10L, Prefs.suggestionFor(8L, "5", "0,10"))
        assertEquals(null, Prefs.suggestionFor(0L, "5", "0,10"))
        assertEquals(180L, Prefs.suggestionFor(200L, "10", "abc"))
    }
}
