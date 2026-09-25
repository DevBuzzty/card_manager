package com.example.yugiohscanner

import com.example.yugiohscanner.ml.OfflineStart
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OfflineStartTest {
    @Test fun `offline nur bei Verbindungsfehler und passendem Konto`() {
        assertEquals("u1", OfflineStart.account(true, "u1", "a@b.de", "a@b.de"))
        assertEquals("u1", OfflineStart.account(true, "u1", "A@B.de ", " a@b.DE"), "Groß/Klein und Leerzeichen egal")
        assertNull(OfflineStart.account(false, "u1", "a@b.de", "a@b.de"), "falsches Passwort o. ä. -> kein Offline-Start")
        assertNull(OfflineStart.account(true, null, "a@b.de", "a@b.de"), "noch nie angemeldet")
        assertNull(OfflineStart.account(true, "u1", null, "a@b.de"))
        assertNull(OfflineStart.account(true, "u1", "a@b.de", "x@y.de"), "anderes Konto sieht nie fremde Daten")
    }

    @Test fun `Wartezeiten wachsen bis 60 Sekunden`() {
        assertEquals(listOf(5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 60_000L, 60_000L), (0..6).map { OfflineStart.retryDelayMs(it) })
        assertEquals(60_000L, OfflineStart.retryDelayMs(100))
    }

    @Test fun `Hinweistext`() {
        assertEquals("Offline – Stand von 14:05, Änderungen erst wieder mit Internet", OfflineStart.hintText("14:05"))
        assertEquals("Offline – Änderungen erst wieder mit Internet", OfflineStart.hintText(null))
    }

    private fun assertEquals(expected: Any?, actual: Any?, msg: String) = org.junit.Assert.assertEquals(msg, expected, actual)
    private fun assertNull(actual: Any?, msg: String) = org.junit.Assert.assertNull(msg, actual)
}
