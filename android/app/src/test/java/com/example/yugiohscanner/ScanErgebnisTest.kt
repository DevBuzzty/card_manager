package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.DruckPreis
import com.example.yugiohscanner.ui.ScanErgebnis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class ScanErgebnisTest {
    private val known = listOf(
        SetOption("RA05-DE038", "Ultra Rare", 0.0, "DE", verified = true),
        SetOption("RA05-DE038", "Secret Rare", 0.0, "DE", verified = true),
        SetOption("CORI-KR027", "Ultra Rare", 0.0, "KR"),
    )
    private val katalog = listOf(
        CatalogPrinting("RA05-DE038", "Ultra Rare", "DE", true, cm = listOf(1)),
        CatalogPrinting("RA05-DE038", "Secret Rare", "DE", true, cm = listOf(2, 3)),
        CatalogPrinting("CORI-KR027", "Ultra Rare", "KR", true, cm = listOf(9)),   // darf nie zaehlen
    )
    private val trends = mapOf(1 to 12.4, 2 to 18.9, 3 to 48.0, 9 to 99.0)
    private fun row(code: String, rarity: String, lang: String, qty: Int, price: Double?) =
        CardRow(id = "1", setCode = code, language = lang, name = "X", imageUrl = null, rarity = rarity, quantity = qty, price = price)

    @Test
    fun `drucke - Preise, Anzahl, KR ohne Cardmarket, eigene Zeilen ergaenzt`() {
        val besitz = listOf(row("CORI-KR027", "Ultra Rare", "KR", 1, 5.11), row("LOB-DE005", "Ultra Rare", "DE", 2, 30.0))
        val d = ScanErgebnis.drucke(known, katalog, besitz) { trends[it] }
        assertEquals(4, d.size)
        assertEquals(DruckPreis.Fest(12.4, false), d[0].preis)
        assertEquals(DruckPreis.Spanne(18.9, 48.0), d[1].preis)
        assertEquals(DruckPreis.Fest(5.11, true), d[2].preis)          // KR: nur eigener Preis
        assertEquals(emptyList<Int>(), d[2].cm)
        assertEquals("LOB-DE005", d[3].setCode); assertEquals(2, d[3].anzahl)
    }

    @Test
    fun `drucke - alter Katalog ohne cm gibt Keiner statt Absturz`() {
        val alt = katalog.map { it.copy(cm = emptyList()) }
        val d = ScanErgebnis.drucke(known, alt, emptyList()) { trends[it] }
        assertEquals(DruckPreis.Keiner, d[0].preis)
    }

    private fun cmFuer(known: SetOption, kat: CatalogPrinting) =
        ScanErgebnis.drucke(listOf(known), listOf(kat), emptyList()) { 7.5 }[0].preis

    @Test
    fun `drucke - DE-Druck findet EN-Katalogprodukt desselben Sets`() {
        val p = cmFuer(SetOption("MAMO-DE072", "Ultra Rare", 0.0, "DE"), CatalogPrinting("MAMO-EN072", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, false), p)
    }

    @Test
    fun `drucke - alte G-Infix-Codes passen zu EN`() {
        val p = cmFuer(SetOption("LOB-G005", "Ultra Rare", 0.0, "DE"), CatalogPrinting("LOB-EN005", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, false), p)
    }

    @Test
    fun `drucke - JP faellt nie auf EN zurueck`() {
        val p = cmFuer(SetOption("XYZ-JP001", "Ultra Rare", 0.0, "JP"), CatalogPrinting("XYZ-EN001", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Keiner, p)
    }

    @Test
    fun `drucke - andere Seltenheit faellt nicht zurueck`() {
        val p = cmFuer(SetOption("MAMO-DE072", "Secret Rare", 0.0, "DE"), CatalogPrinting("MAMO-EN072", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Keiner, p)
    }

    @Test
    fun `drucke - Besitz ohne Seltenheit wird gezaehlt`() {
        val r = CardRow(id = "1", setCode = "LOB-DE005", language = "DE", name = "X", imageUrl = null, rarity = null, quantity = 2, price = 3.0)
        val d = ScanErgebnis.drucke(emptyList(), emptyList(), listOf(r)) { null }
        assertEquals(2, d[0].anzahl)
        assertEquals(DruckPreis.Fest(3.0, true), d[0].preis)
    }

    @Test
    fun `startAuswahl - erkannter Druck, sonst Ersatz, Unknown nie`() {
        assertEquals("RA05-DE038|ultra rare|DE", ScanErgebnis.startAuswahl(known[0], null))
        assertEquals("RA05-DE038|secret rare|DE", ScanErgebnis.startAuswahl(null, known[1]))
        assertNull(ScanErgebnis.startAuswahl(null, SetOption("Unknown", "Unknown", 0.0, "DE")))
        assertNull(ScanErgebnis.startAuswahl(null, null))
    }

    @Test
    fun `kopfPreis - sicher zeigt Auswahl, unsicher Spanne der Kandidaten`() {
        val d = ScanErgebnis.drucke(known, katalog, emptyList()) { trends[it] }
        val auswahl = ScanErgebnis.key("RA05-DE038", "Ultra Rare", "DE")
        assertEquals(DruckPreis.Fest(12.4, false), ScanErgebnis.kopfPreis(d, auswahl, sicher = true, kandidaten = emptyList()))
        assertEquals(DruckPreis.Spanne(12.4, 48.0), ScanErgebnis.kopfPreis(d, auswahl, sicher = false, kandidaten = known.take(2)))
        // ohne Kandidaten und ohne Auswahl: Spanne ueber alle Drucke
        assertEquals(DruckPreis.Spanne(12.4, 48.0), ScanErgebnis.kopfPreis(d.take(2), null, sicher = false, kandidaten = emptyList()))
    }

    @Test
    fun `standText - erst ab 3 Tagen sichtbar`() {
        val heute = LocalDate.of(2026, 10, 4)
        assertNull(ScanErgebnis.standText("2026-10-02", heute))
        assertEquals("Stand 01.10.", ScanErgebnis.standText("2026-10-01", heute))
        assertNull(ScanErgebnis.standText(null, heute))
        assertNull(ScanErgebnis.standText("kaputt", heute))
    }
}
