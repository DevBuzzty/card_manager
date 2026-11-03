package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogRepository
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec 2026-11-03 §8.1 -- Alias-Passcode liest die Daten der Hauptkarte. */
class CatalogAliasTest {
    private val karten = setOf("89631139")
    private val aliase = mapOf("89631140" to "89631139")

    private fun kanonisch(pc: String, abfragen: MutableList<String> = mutableListOf()) =
        CatalogRepository.kanonisch(pc, istKarte = { it in karten }, alias = { abfragen += it; aliase[it] })

    @Test
    fun `Hauptkarte bleibt, ohne Alias-Abfrage`() {
        val abfragen = mutableListOf<String>()
        assertEquals("89631139", kanonisch("89631139", abfragen))
        assertEquals(emptyList<String>(), abfragen)
    }

    @Test
    fun `Alias wird aufgeloest`() {
        assertEquals("89631139", kanonisch("89631140"))
    }

    @Test
    fun `unbekannt bleibt der angefragte Passcode`() {
        assertEquals("12345678", kanonisch("12345678"))
    }
}
