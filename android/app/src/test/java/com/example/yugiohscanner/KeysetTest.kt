package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Keyset
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "Alles nach dieser Zeile" als PostgREST-`or`-Filter. Blaettern nach Schluessel statt nach Versatz:
 * verschwindet waehrend des Blaetterns eine fruehere Zeile, rueckt beim Versatz alles vor und eine
 * Zeile wird still uebersprungen -- beim Schluessel nicht (Spec §4.1).
 */
class KeysetTest {

    @Test fun `ein Schluessel`() {
        assertEquals("(copy_id.gt.\"abc\")", Keyset.after(listOf("copy_id"), listOf("abc")))
    }

    @Test fun `zusammengesetzter Kartenschluessel`() {
        val expected = "(id.gt.\"1\"," +
            "and(id.eq.\"1\",set_code.gt.\"LOB-DE001\")," +
            "and(id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.gt.\"DE\")," +
            "and(id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.eq.\"DE\",rarity.gt.\"Secret Rare\"))"
        assertEquals(
            expected,
            Keyset.after(listOf("id", "set_code", "language", "rarity"), listOf("1", "LOB-DE001", "DE", "Secret Rare")),
        )
    }

    @Test fun `Zeitstempel vor dem Schluessel`() {
        assertEquals(
            "(updated_at.gt.\"2026-09-13T12:00:00.500Z\",and(updated_at.eq.\"2026-09-13T12:00:00.500Z\",copy_id.gt.\"u1\"))",
            Keyset.after(listOf("updated_at", "copy_id"), listOf("2026-09-13T12:00:00.500Z", "u1")),
        )
    }

    @Test fun `Komma und Klammern bleiben im Wert`() {
        assertEquals("\"a,b (c)\"", Keyset.quote("a,b (c)"))
    }

    @Test fun `Anfuehrungszeichen und Backslash werden maskiert`() {
        assertEquals("\"x\\\"y\\\\z\"", Keyset.quote("x\"y\\z"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `Spalten und Werte muessen gleich viele sein`() {
        Keyset.after(listOf("a", "b"), listOf("1"))
    }
}
