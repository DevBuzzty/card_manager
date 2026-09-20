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
}
