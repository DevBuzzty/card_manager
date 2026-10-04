package com.example.yugiohscanner

import com.example.yugiohscanner.ui.ScanOverlayLogik
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanOverlayLogikTest {
    @Test fun `pcText`() {
        assertEquals("PC verbunden", ScanOverlayLogik.pcText(true))
        assertEquals("nur Handy", ScanOverlayLogik.pcText(false))
    }

    @Test fun `sprachText - Auto oder Flagge mit Code`() {
        assertEquals("🌐 Auto", ScanOverlayLogik.sprachText(null))
        assertEquals("🇩🇪 DE", ScanOverlayLogik.sprachText("DE"))
    }

    @Test fun `naechsteSprache - Auto DE EN KR JP und zurueck auf Auto`() {
        assertEquals("DE", ScanOverlayLogik.naechsteSprache(null))
        assertEquals("EN", ScanOverlayLogik.naechsteSprache("DE"))
        assertEquals("KR", ScanOverlayLogik.naechsteSprache("EN"))
        assertEquals("JP", ScanOverlayLogik.naechsteSprache("KR"))
        assertNull(ScanOverlayLogik.naechsteSprache("JP"))
    }

    @Test fun `modusEtikett und fokusText`() {
        assertEquals("EINZELN", ScanOverlayLogik.modusEtikett("einzeln"))
        assertEquals("STAPEL", ScanOverlayLogik.modusEtikett("stapel"))
        assertEquals("EINZELN", ScanOverlayLogik.modusEtikett("irgendwas"))
        assertEquals("◎ Fokus", ScanOverlayLogik.fokusText(false))
        assertEquals("◎ Fokus fest", ScanOverlayLogik.fokusText(true))
    }

    @Test fun `Leisten- und Zaehlertexte mit Einzahl`() {
        assertEquals("1 Karte vorgemerkt", ScanOverlayLogik.vorgemerktText(1))
        assertEquals("3 Karten vorgemerkt", ScanOverlayLogik.vorgemerktText(3))
        assertEquals("27 an den PC gesendet", ScanOverlayLogik.gesendetText(27))
        assertEquals("+0", ScanOverlayLogik.zaehlerText(0))
        assertEquals("+27", ScanOverlayLogik.zaehlerText(27))
    }

    @Test fun `ipGueltig - leer oder Leerzeichen ist ungueltig`() {
        assertFalse(ScanOverlayLogik.ipGueltig(""))
        assertFalse(ScanOverlayLogik.ipGueltig("   "))
        assertTrue(ScanOverlayLogik.ipGueltig("192.168.0.20"))
    }
}
