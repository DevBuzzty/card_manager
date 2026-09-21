package com.example.yugiohscanner

import com.example.yugiohscanner.ml.FotoAuswahl
import com.example.yugiohscanner.ml.FotoAuswahl.Kandidat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FotoAuswahlTest {

    @Test
    fun `die hingehaltene, also groesste Karte gewinnt ueber Nachbarn und Hintergrund`() {
        val foto = listOf(Kandidat(111, 20_000f), Kandidat(222, 180_000f), Kandidat(333, 5_000f))
        assertEquals(222, FotoAuswahl.groesste(foto)?.passcode)
    }

    @Test
    fun `nicht erkannte Boxen zaehlen nicht`() {
        assertEquals(111, FotoAuswahl.groesste(listOf(Kandidat(-1, 900_000f), Kandidat(111, 50_000f)))?.passcode)
        assertNull(FotoAuswahl.groesste(listOf(Kandidat(-1, 900_000f), Kandidat(0, 5f))))
        assertNull(FotoAuswahl.groesste(emptyList()))
    }

    @Test
    fun `die Mehrheit der Serie entscheidet, ein verlesenes Foto faellt raus`() {
        val serie = listOf(Kandidat(222, 180_000f), Kandidat(999, 190_000f), Kandidat(222, 170_000f))
        assertEquals(222, FotoAuswahl.sieger(serie))
    }

    @Test
    fun `bei Gleichstand zaehlt das Foto mit der groessten Karte`() {
        val serie = listOf(Kandidat(222, 150_000f), null, Kandidat(333, 200_000f))
        assertEquals(333, FotoAuswahl.sieger(serie))
    }

    @Test
    fun `eine Serie ohne jede Karte hat keinen Sieger`() {
        assertNull(FotoAuswahl.sieger(listOf(null, null, null)))
        assertNull(FotoAuswahl.sieger(emptyList()))
    }
}
