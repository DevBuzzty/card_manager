package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.KartenInfo
import com.example.yugiohscanner.ui.KartenInfo.Waehrung
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KartenInfoTest {

    private fun druck(code: String, rarity: String, lang: String, usd: Double = 0.0) = SetOption(code, rarity, usd, lang)
    private fun mein(code: String, rarity: String, lang: String, eur: Double?, n: Int) =
        CardRow(id = "73452089", setCode = code, language = lang, name = "Dark Cavalry", imageUrl = null,
            rarity = rarity, quantity = n, price = eur)

    @Test
    fun `eigener Druck zeigt den Euro-Preis und die Anzahl`() {
        val z = KartenInfo.preiszeilen(
            listOf(druck("MAMO-DE072", "Ultra Rare", "DE"), druck("MAMO-EN072", "Ultra Rare", "EN", usd = 1.20)),
            listOf(mein("MAMO-DE072", "Ultra Rare", "DE", eur = 0.85, n = 2)),
        ).first { it.setCode == "MAMO-DE072" }
        assertEquals(0.85, z.preis!!, 1e-9)
        assertEquals(Waehrung.EUR, z.waehrung)
        assertEquals(2, z.anzahl)
    }

    @Test
    fun `fremder deutscher Druck bekommt den Dollar-Richtwert seines englischen Zwillings`() {
        val z = KartenInfo.preiszeilen(
            listOf(druck("MAMO-DE072", "Ultra Rare", "DE"), druck("MAMO-EN072", "Ultra Rare", "EN", usd = 1.20)),
            emptyList(),
        ).first { it.setCode == "MAMO-DE072" }
        assertEquals(1.20, z.preis!!, 1e-9)
        assertEquals(Waehrung.USD, z.waehrung)
        assertEquals(0, z.anzahl)
    }

    @Test
    fun `der Dollar-Zwilling muss dieselbe Rarity haben`() {
        // Ein Starlight Rare darf nicht den Preis des Ultra Rare derselben Nummer erben -- und umgekehrt.
        val zeilen = KartenInfo.preiszeilen(
            listOf(
                druck("MAMO-EN015", "Ultra Rare", "EN", usd = 2.0), druck("MAMO-EN015", "Starlight Rare", "EN", usd = 180.0),
                druck("MAMO-DE015", "Ultra Rare", "DE"),
            ),
            emptyList(),
        )
        assertEquals(2.0, zeilen.first { it.setCode == "MAMO-DE015" }.preis!!, 1e-9)
    }

    @Test
    fun `teuerster Druck zuerst, ohne Preis ans Ende`() {
        val zeilen = KartenInfo.preiszeilen(
            listOf(
                druck("DUPO-EN002", "Ultra Rare", "EN", usd = 0.5), druck("26DE-DEG07", "Common", "DE"),
                druck("MAMO-EN072", "Ultra Rare", "EN", usd = 1.2),
            ),
            emptyList(),
        )
        assertEquals(listOf("MAMO-EN072", "DUPO-EN002", "26DE-DEG07"), zeilen.map { it.setCode })
        assertNull(zeilen.last().preis)
    }

    @Test
    fun `unbekannte Rarity uebernimmt die eine bekannte des Geschwisters`() {
        val z = KartenInfo.preiszeilen(
            listOf(druck("MAMO-DE072", "Unknown", "DE"), druck("MAMO-EN072", "Ultra Rare", "EN", usd = 1.2)),
            emptyList(),
        ).first { it.language == "DE" }
        assertEquals("Ultra Rare", z.rarity)
    }

    @Test
    fun `ein eigener Druck, der in der Liste fehlt, kommt trotzdem dazu`() {
        val zeilen = KartenInfo.preiszeilen(emptyList(), listOf(mein("LOB-G005", "Ultra Rare", "DE", eur = 12.0, n = 1)))
        assertEquals(1, zeilen.size)
        assertEquals(Waehrung.EUR, zeilen[0].waehrung)
    }

    @Test
    fun `keine Dublette zwischen Liste und Sammlung`() {
        val zeilen = KartenInfo.preiszeilen(
            listOf(druck("MAMO-DE072", "Ultra Rare", "DE")),
            listOf(mein("MAMO-DE072", "Ultra Rare", "DE", eur = 0.85, n = 1)),
        )
        assertEquals(1, zeilen.size)
    }
}
