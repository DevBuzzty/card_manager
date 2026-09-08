package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.RarityRank
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [RarityRank] (Spec D3 Task 3) -- the Kotlin counterpart of the desktop's `findBestDefaultSet`
 * (desktop/electron/main.cjs:123). Pins the rank table verbatim against the desktop original,
 * including the inherited (not meaningful) gap between rank 6 and the rank-10 fallback, and
 * covers the two deliberate departures from the desktop tie-break documented on [RarityRank.lowest]:
 * SetOption's price is not reliably populated on this path, so ties are broken by input order
 * instead of price.
 */
class RarityRankTest {

    private fun opt(rarity: String, code: String = "LOB-DE005", price: Double = 0.0) =
        SetOption(setCode = code, rarity = rarity, price = price)

    // -- rank(): full order, verbatim against the desktop's getRank -----------------------------

    @Test fun `Rangfolge vollstaendig, wie am Desktop`() {
        assertEquals(1, RarityRank.rank("Common"))
        assertEquals(2, RarityRank.rank("Short Print"))
        assertEquals(3, RarityRank.rank("Rare"))
        assertEquals(4, RarityRank.rank("Super Rare"))
        assertEquals(5, RarityRank.rank("Ultra Rare"))
        assertEquals(6, RarityRank.rank("Secret Rare"))
    }

    @Test fun `Gross- und Kleinschreibung ist egal`() {
        assertEquals(6, RarityRank.rank("SECRET RARE"))
        assertEquals(6, RarityRank.rank("secret rare"))
        assertEquals(6, RarityRank.rank("Secret Rare"))
    }

    @Test fun `null und unbekannte Rarity landen beide auf Rang 10, nicht 7`() {
        // Die Luecke zwischen 6 und 10 ist vom Desktop-Original geerbt, nicht bedeutungsvoll --
        // absichtlich nicht auf 7 umnummeriert, siehe Kommentar auf RarityRank.rank.
        assertEquals(10, RarityRank.rank(null))
        assertEquals(10, RarityRank.rank(""))
        assertEquals(10, RarityRank.rank("Ghost Rare"))
        assertEquals(10, RarityRank.rank("Platinum Secret Rare"))
    }

    // -- lowest(): Vorauswahl ---------------------------------------------------------------------

    @Test fun `lowest waehlt die niedrigste Rarity nach Rangfolge`() {
        val options = listOf(opt("Secret Rare"), opt("Common"), opt("Ultra Rare"))
        val result = RarityRank.lowest(options)!!
        assertEquals("Common", result.lowest.rarity)
    }

    @Test fun `lowest bei Gleichstand ist stabil -- Eingabereihenfolge entscheidet`() {
        // Zwei Optionen teilen sich Rang 10 (beide unbekannt/leer) -- ohne verlaesslichen Preis
        // (siehe Kommentar auf RarityRank.lowest) gewinnt die erste in der Eingabe, nicht eine
        // erfundene Ersatzordnung.
        val first = opt("Platinum Secret Rare", price = 5.0)
        val second = opt("Ghost Rare", price = 1.0) // guenstiger, darf trotzdem NICHT gewinnen
        val result = RarityRank.lowest(listOf(first, second))!!
        assertTrue(result.lowest === first)

        // Reihenfolge umgedreht -> jetzt gewinnt "second", weil es zuerst kommt.
        val flipped = RarityRank.lowest(listOf(second, first))!!
        assertTrue(flipped.lowest === second)
    }

    @Test fun `lowest liefert null fuer eine leere Liste`() {
        assertNull(RarityRank.lowest(emptyList()))
    }

    // -- Mehrdeutigkeit: sichtbar machen, nicht verstecken -----------------------------------------

    @Test fun `mehrere unterschiedliche Rarities werden als mehrdeutig gemeldet`() {
        val result = RarityRank.lowest(listOf(opt("Ultra Rare"), opt("Secret Rare")))!!
        assertTrue(result.isAmbiguous)
        assertEquals(listOf("Ultra Rare", "Secret Rare"), result.distinctRarities)
    }

    @Test fun `dieselbe Rarity mehrfach -- keine Mehrdeutigkeit`() {
        val result = RarityRank.lowest(listOf(opt("Common"), opt("Common"), opt("Common")))!!
        assertFalse(result.isAmbiguous)
        assertEquals(listOf("Common"), result.distinctRarities)
    }

    @Test fun `Mehrdeutigkeit ignoriert Gross- Kleinschreibung beim Zaehlen der Rarities`() {
        val result = RarityRank.lowest(listOf(opt("Secret Rare"), opt("SECRET RARE"), opt("secret rare")))!!
        assertFalse(result.isAmbiguous)
        // Erste gesehene Schreibweise wird beibehalten.
        assertEquals(listOf("Secret Rare"), result.distinctRarities)
    }

    @Test fun `einzelne Option ist nie mehrdeutig`() {
        val result = RarityRank.lowest(listOf(opt("Common")))!!
        assertFalse(result.isAmbiguous)
    }
}
