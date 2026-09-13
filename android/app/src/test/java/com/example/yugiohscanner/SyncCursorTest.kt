package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SyncCursor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** Der Stichtag kommt vom Server, nie von der Uhr des Handys (Spec §4.3). */
class SyncCursorTest {

    @Test fun `Stichtag ist der spaeteste gelieferte Zeitpunkt`() {
        assertEquals(
            "2026-09-13T12:00:02+00:00",
            SyncCursor.advance(null, listOf("2026-09-13T12:00:01+00:00", "2026-09-13T12:00:02+00:00", null)),
        )
    }

    @Test fun `ohne Lieferung bleibt der Stichtag`() {
        assertEquals("2026-09-13T12:00:00+00:00", SyncCursor.advance("2026-09-13T12:00:00+00:00", emptyList()))
        assertNull(SyncCursor.advance(null, listOf(null)))
    }

    @Test fun `aelter Geliefertes schiebt den Stichtag nicht zurueck`() {
        assertEquals(
            "2026-09-13T12:00:00+00:00",
            SyncCursor.advance("2026-09-13T12:00:00+00:00", listOf("2026-09-13T11:00:00+00:00")),
        )
    }

    @Test fun `verglichen wird als Zeitpunkt, nicht als Zeichenkette`() {
        // ".7" ist spaeter als ".07"; "+02:00" ist zwei Stunden frueher als dieselbe Uhrzeit in UTC.
        assertEquals(
            "2026-01-01T00:00:00.7+00:00",
            SyncCursor.advance("2026-01-01T00:00:00.07+00:00", listOf("2026-01-01T00:00:00.7+00:00")),
        )
        assertEquals(
            "2026-01-01T01:30:00+00:00",
            SyncCursor.advance("2026-01-01T02:00:00+02:00", listOf("2026-01-01T01:30:00+00:00")),
        )
    }

    @Test fun `Untergrenze zieht 60 Sekunden ab und schreibt mit Z`() {
        assertEquals("2026-09-13T11:59:30.123456Z", SyncCursor.lowerBound("2026-09-13T12:00:30.123456+00:00"))
    }

    @Test fun `ohne Stichtag ab 1970`() {
        assertEquals("1970-01-01T00:00:00Z", SyncCursor.lowerBound(null))
    }

    @Test fun `normalisierte Form enthaelt kein Plus`() {
        val n = SyncCursor.normalize("2026-09-13T12:00:00.5+00:00")
        assertEquals("2026-09-13T12:00:00.500Z", n)
        assertFalse(n.contains('+'))
    }
}
