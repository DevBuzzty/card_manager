package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.RarityQuellen
import com.example.yugiohscanner.cloud.SetOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Zwilling von `desktop/electron/rarity-sources.test.cjs` -- dieselben Faelle, dieselben Daten. */
class RarityQuellenTest {

    private fun s(code: String, rarity: String, lang: String = "DE") = SetOption(code, rarity, 0.0, lang)

    @Test
    fun `kennt die Quelle eine Rarity`() {
        assertTrue(RarityQuellen.kenntRarity("Ultra Rare"))
        assertFalse(RarityQuellen.kenntRarity(""))
        assertFalse(RarityQuellen.kenntRarity(null))
        assertFalse(RarityQuellen.kenntRarity("Unknown"))
        assertFalse(RarityQuellen.kenntRarity("New"))
        assertFalse(RarityQuellen.kenntRarity("new"))
        assertFalse(RarityQuellen.kenntRarity("   "))
    }

    @Test
    fun `der echte Fall - Konami steuert nichts bei, das Wiki kennt Ultra Rare`() {
        val union = listOf(s("BLGG-DE055", "Ultra Rare"), s("BLGG-DE055", "Ultra Rare"), s("BLGG-DE055", ""))
        assertEquals(
            listOf(s("BLGG-DE055", "Ultra Rare"), s("BLGG-DE055", "Ultra Rare")),
            RarityQuellen.ohneErfundeneRarity(union),
        )
    }

    @Test
    fun `kennt keine Quelle die Rarity, bleibt EINE ehrliche Zeile`() {
        assertEquals(
            listOf(s("XYZ-DE001", "Unknown")),
            RarityQuellen.ohneErfundeneRarity(listOf(s("XYZ-DE001", ""), s("XYZ-DE001", ""))),
        )
    }

    @Test
    fun `echte Mehrdeutigkeit bleibt - MAMO-DE015 als Ultra UND als Starlight Rare`() {
        val union = listOf(s("MAMO-DE015", "Ultra Rare"), s("MAMO-DE015", "Starlight Rare"), s("MAMO-DE015", ""))
        assertEquals(
            listOf(s("MAMO-DE015", "Ultra Rare"), s("MAMO-DE015", "Starlight Rare")),
            RarityQuellen.ohneErfundeneRarity(union),
        )
    }

    @Test
    fun `Gross-Kleinschreibung des Codes trennt nicht, andere Felder bleiben`() {
        val union = listOf(SetOption("blgg-de055", "Ultra Rare", 7.0, "DE"), s("BLGG-DE055", ""))
        assertEquals(listOf(SetOption("blgg-de055", "Ultra Rare", 7.0, "DE")), RarityQuellen.ohneErfundeneRarity(union))
    }

    @Test
    fun `der zweite echte Fall - YGOPRODeck sagt New, das Wiki kennt Ultra Rare`() {
        val union = listOf(s("BLGG-EN045", "New", "EN"), s("BLGG-EN045", "Ultra Rare", "EN"))
        assertEquals(listOf(s("BLGG-EN045", "Ultra Rare", "EN")), RarityQuellen.ohneErfundeneRarity(union))
    }

    @Test
    fun `kennt nur YGOPRODeck den Druck und sagt New, bleibt es ehrlich unbekannt`() {
        assertEquals(
            listOf(s("BLGG-EN045", "Unknown", "EN")),
            RarityQuellen.ohneErfundeneRarity(listOf(s("BLGG-EN045", "New", "EN"))),
        )
    }

    @Test
    fun `leere Eingabe und saubere Listen bleiben, wie sie sind`() {
        assertEquals(emptyList<SetOption>(), RarityQuellen.ohneErfundeneRarity(emptyList()))
        val sauber = listOf(s("A-DE001", "Common"), s("B-DE002", "Rare"))
        assertEquals(sauber, RarityQuellen.ohneErfundeneRarity(sauber))
    }

    // --- Der Fall LAVD, gemessen am 20.09.2026 -------------------------------------------------
    // YGOPRODeck liefert fuer "Legendary Arc-V Decks" woertlich:
    //   {"set_code":"LAVD-ENO11","set_rarity":"3"}
    // Auf der Karte steht LAVD-DE011, und die OCR des Nutzers las das korrekt.

    @Test
    fun `der Buchstabe O in einer Kartennummer ist eine Null`() {
        assertEquals("LAVD-EN011", RarityQuellen.repariereQuellcode("LAVD-ENO11"))
        assertEquals("LAVD-DE019", RarityQuellen.repariereQuellcode("LAVD-DEO19"))
        assertEquals("LAVD-EN122", RarityQuellen.repariereQuellcode("LAVD-ENI22"))
    }

    @Test
    fun `echte Codes bleiben unangetastet`() {
        // SGX3-DEA10 hat einen ECHTEN Variantenbuchstaben -- A, nicht O oder I.
        for (c in listOf("SGX3-DEA10", "LOB-EN001", "MAMO-DE103", "TP1-G015", "RA01-EN075")) {
            assertEquals(c, RarityQuellen.repariereQuellcode(c))
        }
    }

    @Test
    fun `eine Rarity ohne Buchstaben ist keine Rarity`() {
        assertFalse(RarityQuellen.kenntRarity("3"))
        assertFalse(RarityQuellen.kenntRarity("2"))
        assertFalse(RarityQuellen.kenntRarity("  7 "))
        assertTrue(RarityQuellen.kenntRarity("Ultra Rare"))
        assertTrue(RarityQuellen.kenntRarity("20th Secret Rare"))
    }

    @Test
    fun `der ganze LAVD-Druck wird beim Zusammenfuehren geradegezogen`() {
        val roh = listOf(
            SetOption("LAVD-ENO11", "3", 0.0, "EN"),
            SetOption("LAVD-DEO11", "Ultra Rare", 0.0, "DE"),
        )
        assertEquals(
            listOf(SetOption("LAVD-EN011", "Unknown", 0.0, "EN"), SetOption("LAVD-DE011", "Ultra Rare", 0.0, "DE")),
            RarityQuellen.ohneErfundeneRarity(roh),
        )
    }
}
