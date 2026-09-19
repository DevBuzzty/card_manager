package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SprachHinweis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Beispieltexte: echte OCR-Lesungen vom Geraet (geraet-4/5-roh.log, Scan-Protokoll 19.09.). */
class SprachHinweisTest {

    @Test fun `deutscher Effekttext`() {
        assertEquals("DE", SprachHinweis.aus(listOf(
            "auf den Friedhof | 2000 oder weniger | beschwören.",
            "BLGG-DEOS3 | en Friedhof",
        )))
    }

    @Test fun `englischer Effekttext`() {
        assertEquals("EN", SprachHinweis.aus(listOf(
            "ent to the GY: You can | 000 or less DEF from",
            "Once per Chain, if an Effect Monster is Special Summoned",
        )))
    }

    @Test fun `Typzeile und Auflage allein reichen, wenn eindeutig`() {
        assertEquals("DE", SprachHinweis.aus(listOf("[FALLENKARTE]", "1. Auflage", "Zerstöre 1 Karte auf dem Spielfeld")))
        assertEquals("EN", SprachHinweis.aus(listOf("[TRAP CARD]", "1st Edition", "destroy 1 card on the field")))
    }

    @Test fun `zu wenig oder gemischter Text gibt keine Entscheidung`() {
        assertNull(SprachHinweis.aus(listOf("BLGG-EN053")))
        assertNull(SprachHinweis.aus(listOf("")))
        assertNull(SprachHinweis.aus(listOf("the card und die Karte you deine")))
    }

    @Test fun `Woerter in beiden Sprachen zaehlen nicht`() {
        assertNull(SprachHinweis.aus(listOf("Deck Hand Monster Deck Hand Monster")))
    }
}
