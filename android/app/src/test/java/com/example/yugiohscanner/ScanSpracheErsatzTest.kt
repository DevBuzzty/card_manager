package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanSprache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Abnahme 01.10.2026: las das Handy keinen Set-Code, buchte es trotz fester Sprache KR als DE. */
class ScanSpracheErsatzTest {
    private val de = SetOption("CORI-DE030", "Rare", 0.0, "DE", verified = true)
    private val kr1 = SetOption("CORI-KR031", "Common", 0.0, "KR")
    private val kr2 = SetOption("CORI-KR030", "Rare", 0.0, "KR", verified = true)

    @Test fun `ohne feste Sprache kein Ersatz`() {
        assertNull(ScanSprache.ersatzDruck(null, listOf(de, kr1)))
    }

    @Test fun `erster Druck der festen Sprache, verifizierte zuerst`() {
        assertEquals(kr2, ScanSprache.ersatzDruck("KR", listOf(de, kr1, kr2)))
    }

    @Test fun `kein Druck der Sprache bekannt ergibt Unknown in dieser Sprache`() {
        assertEquals(SetOption("Unknown", "Unknown", 0.0, "KR"), ScanSprache.ersatzDruck("KR", listOf(de)))
    }
}
