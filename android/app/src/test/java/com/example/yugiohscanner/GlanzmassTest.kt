package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Glanzmass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GlanzmassTest {

    private fun argb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun `leere Flaeche meldet keinen Glanz`() {
        val w = Glanzmass.aus(IntArray(0))
        assertEquals(0f, w.hell, 0.0001f)
        assertEquals(0f, w.bunt, 0.0001f)
    }

    @Test
    fun `eine matte graue Flaeche hat weder Glanzlichter noch Farbstreuung`() {
        val w = Glanzmass.aus(IntArray(100) { argb(120, 120, 120) })
        assertEquals(0f, w.hell, 0.0001f)
        assertEquals(0f, w.bunt, 0.0001f)
    }

    @Test
    fun `der Anteil heller Punkte wird gezaehlt, nicht geschaetzt`() {
        // 25 von 100 Punkten ueber der Grenze.
        val p = IntArray(100) { if (it < 25) argb(250, 250, 250) else argb(10, 10, 10) }
        assertEquals(0.25f, Glanzmass.aus(p).hell, 0.0001f)
    }

    @Test
    fun `die Grenze liegt bei 240 und wird eingeschlossen`() {
        assertEquals(1f, Glanzmass.aus(IntArray(4) { argb(240, 0, 0) }).hell, 0.0001f)
        assertEquals(0f, Glanzmass.aus(IntArray(4) { argb(239, 0, 0) }).hell, 0.0001f)
    }

    @Test
    fun `eine einfarbige Flaeche streut nicht, eine regenbogenbunte schon`() {
        val einfarbig = Glanzmass.aus(IntArray(90) { argb(200, 30, 30) })
        val bunt = Glanzmass.aus(IntArray(90) {
            when (it % 3) { 0 -> argb(200, 30, 30); 1 -> argb(30, 200, 30); else -> argb(30, 30, 200) }
        })
        assertEquals(0f, einfarbig.bunt, 0.01f)
        assertTrue("bunt=${bunt.bunt}", bunt.bunt > 0.8f)
    }

    @Test
    fun `graue Punkte ohne Farbton verfaelschen die Streuung nicht`() {
        // Grau hat keinen Farbton -- es darf die Streuung weder aufblaehen noch auf null ziehen.
        val nurRot = Glanzmass.aus(IntArray(50) { argb(200, 30, 30) })
        val rotMitGrau = Glanzmass.aus(IntArray(100) { if (it < 50) argb(200, 30, 30) else argb(128, 128, 128) })
        assertTrue("grau darf nicht stark streuen: ${rotMitGrau.bunt}", rotMitGrau.bunt < 0.3f)
        assertEquals(0f, nurRot.bunt, 0.01f)
    }

    @Test
    fun `der Namenszug - dunkle Schrift auf hellem Feld gegen helle Schrift`() {
        fun feld(schrift: Int, grund: Int) = IntArray(100) { if (it < 25) argb(schrift, schrift, schrift) else argb(grund, grund, grund) }
        // Common: schwarze Buchstaben. Ultra Rare: goldene, also helle.
        val common = Glanzmass.namensMass(feld(20, 200))
        val foil = Glanzmass.namensMass(feld(180, 200))
        assertEquals(20f, common.schrift, 0.5f)
        assertEquals(180f, foil.schrift, 0.5f)
        assertTrue("helle Schrift muss hoeher liegen", foil.schrift > common.schrift)
    }

    @Test
    fun `das 20 Perzentil nimmt die Buchstaben, nicht den Untergrund`() {
        // 25 dunkle Punkte unter 75 hellen: der Mittelwert laege bei ~155 und verfehlte die Schrift.
        val p = IntArray(100) { if (it < 25) argb(10, 10, 10) else argb(200, 200, 200) }
        assertEquals(10f, Glanzmass.namensMass(p).schrift, 0.5f)
    }

    @Test
    fun `leerer Namenszug meldet nichts`() {
        assertEquals(0f, Glanzmass.namensMass(IntArray(0)).schrift, 0.0001f)
        assertEquals(0f, Glanzmass.namensMass(IntArray(0)).saettigung, 0.0001f)
    }

    @Test
    fun `graue Flaeche ist unbunt, farbige nicht`() {
        assertEquals(0f, Glanzmass.namensMass(IntArray(50) { argb(128, 128, 128) }).saettigung, 0.5f)
        assertTrue(Glanzmass.namensMass(IntArray(50) { argb(200, 20, 20) }).saettigung > 200f)
    }
}
