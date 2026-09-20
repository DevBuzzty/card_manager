package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ReadSetCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReadSetCodeTest {

    @Test
    fun `ohne Text und ohne Set-Code kommt nichts zurueck`() {
        assertNull(ReadSetCode.aus(emptyList()))
        assertNull(ReadSetCode.aus(listOf("Solfachord Happiness", "SCHNELLZAUBER", "")))
    }

    @Test
    fun `der Code wird gelesen, auch wenn er zu keinem bekannten Druck passt`() {
        // Genau der Fall vom 19.09.: das Bild sagte eine ANGU-Schwesterkarte, gedruckt war MAMO.
        assertEquals("MAMO-DE103", ReadSetCode.aus(listOf("MAMO-DE103 Solfachord Happiness")))
    }

    @Test
    fun `der haeufigste Fund gewinnt, nicht der erste`() {
        val bilder = listOf(
            "MAMO-DE1O3",          // einmaliges Verlesen (0 als O)
            "MAMO-DE103",
            "MAMO-DE103 Ultra",
            "MAMO-DE103",
        )
        assertEquals("MAMO-DE103", ReadSetCode.aus(bilder))
    }

    @Test
    fun `bei Gleichstand gewinnt der zuerst gesehene`() {
        assertEquals("DOOD-DE065", ReadSetCode.aus(listOf("DOOD-DE065", "MAMO-DE103")))
    }

    @Test
    fun `mehrfach im selben Bild zaehlt einmal`() {
        // Sonst schluege ein einziges Bild mit doppeltem Aufdruck zwei ruhige Bilder.
        val bilder = listOf("ANGU-DE014 ANGU-DE014", "MAMO-DE103", "MAMO-DE103")
        assertEquals("MAMO-DE103", ReadSetCode.aus(bilder))
    }
}
