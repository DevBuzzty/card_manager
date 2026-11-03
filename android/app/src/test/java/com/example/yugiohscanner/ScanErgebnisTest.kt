package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.CmPriceFile
import com.example.yugiohscanner.cloud.CmResolveRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.DruckPreis
import com.example.yugiohscanner.ui.DruckPreis.Quelle
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ui.ResolvedScan
import com.example.yugiohscanner.ui.ScanErgebnis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
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
        val d = ScanErgebnis.drucke(known, katalog, besitz, { trends[it] })
        assertEquals(4, d.size)
        assertEquals(DruckPreis.Fest(12.4, Quelle.TREND), d[0].preis)
        assertEquals(DruckPreis.Spanne(18.9, 48.0, setOf(Quelle.TREND)), d[1].preis)
        assertEquals(DruckPreis.Fest(5.11, Quelle.SAMMLUNG), d[2].preis)          // KR: nur eigener Preis
        assertEquals(emptyList<Int>(), d[2].cm)
        assertEquals("LOB-DE005", d[3].setCode); assertEquals(2, d[3].anzahl)
        assertTrue(d.none { it.abgeleitet })
    }

    @Test
    fun `drucke - alter Katalog ohne cm gibt Keiner statt Absturz`() {
        val alt = katalog.map { it.copy(cm = emptyList()) }
        val d = ScanErgebnis.drucke(known, alt, emptyList(), { trends[it] })
        assertEquals(DruckPreis.Keiner, d[0].preis)
    }

    private fun preisFuer(known: SetOption, kat: CatalogPrinting) =
        ScanErgebnis.drucke(listOf(known), listOf(kat), emptyList(), { 7.5 })[0].preis

    @Test
    fun `drucke - DE-Druck findet EN-Katalogprodukt desselben Sets`() {
        val p = preisFuer(SetOption("MAMO-DE072", "Ultra Rare", 0.0, "DE"), CatalogPrinting("MAMO-EN072", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), p)
    }

    @Test
    fun `drucke - alte G-Infix-Codes passen zu EN`() {
        val p = preisFuer(SetOption("LOB-G005", "Ultra Rare", 0.0, "DE"), CatalogPrinting("LOB-EN005", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), p)
    }

    @Test
    fun `drucke - regionsloser Code LOB-005 trifft LOB-EN005`() {
        val p = preisFuer(SetOption("LOB-005", "Ultra Rare", 0.0, "EN"), CatalogPrinting("LOB-EN005", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), p)
    }

    @Test
    fun `drucke - Starfoil trifft Starfoil Rare`() {
        val p = preisFuer(SetOption("SP15-DE001", "Starfoil", 0.0, "DE"), CatalogPrinting("SP15-EN001", "Starfoil Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), p)
        val gleicherCode = preisFuer(SetOption("SP15-EN001", "Starfoil Rare", 0.0, "EN"), CatalogPrinting("SP15-EN001", "Starfoil", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), gleicherCode)
    }

    @Test
    fun `drucke - JP faellt nie auf EN zurueck`() {
        val p = preisFuer(SetOption("XYZ-JP001", "Ultra Rare", 0.0, "JP"), CatalogPrinting("XYZ-EN001", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Keiner, p)
        val unbekannt = preisFuer(SetOption("XYZ-JP001", "Unknown", 0.0, "JP"), CatalogPrinting("XYZ-EN001", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Keiner, unbekannt)
    }

    @Test
    fun `drucke - JP mit eigenem Katalog-cm bekommt Trend`() {
        val p = preisFuer(SetOption("XYZ-JP001", "Ultra Rare", 0.0, "JP"), CatalogPrinting("XYZ-JP001", "Ultra Rare", "JP", true, cm = listOf(1)))
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), p)
    }

    @Test
    fun `drucke - KR weiterhin ohne cm, auch mit Katalog-cm am selben Code`() {
        val d = ScanErgebnis.drucke(listOf(SetOption("CORI-KR027", "Ultra Rare", 0.0, "KR")),
            listOf(CatalogPrinting("CORI-KR027", "Ultra Rare", "KR", true, cm = listOf(9))), emptyList(), { 7.5 })
        assertEquals(emptyList<Int>(), d[0].cm)
        assertEquals(DruckPreis.Keiner, d[0].preis)
    }

    @Test
    fun `drucke - andere Seltenheit faellt nicht zurueck`() {
        val p = preisFuer(SetOption("MAMO-DE072", "Secret Rare", 0.0, "DE"), CatalogPrinting("MAMO-EN072", "Ultra Rare", null, false, cm = listOf(1)))
        assertEquals(DruckPreis.Keiner, p)
    }

    @Test
    fun `drucke - Seltenheit Unknown vereinigt die cm aller Drucke desselben Codes`() {
        val kat = listOf(
            CatalogPrinting("LOB-EN001", "Ultra Rare", null, false, cm = listOf(5)),
            CatalogPrinting("LOB-EN001", "Secret Rare", null, false, cm = listOf(3, 5)),
            CatalogPrinting("LOB-EN002", "Common", null, false, cm = listOf(8)),
        )
        val t = mapOf(3 to 2.0, 5 to 9.0)
        val mehrere = ScanErgebnis.drucke(listOf(SetOption("LOB-DE001", "Unknown", 0.0, "DE")), kat, emptyList(), { t[it] })[0]
        assertEquals(listOf(3, 5), mehrere.cm)                                        // ueber CodeKey, sortiert, ohne Doppelte
        assertEquals(DruckPreis.Spanne(2.0, 9.0, setOf(Quelle.TREND)), mehrere.preis)
        assertEquals("Unknown", mehrere.rarity)
        // gleicher Code geht vor CodeKey: nur der eine EN-Druck mit genau diesem Code
        val eine = ScanErgebnis.drucke(listOf(SetOption("LOB-EN002", "", 0.0, "EN")), kat, emptyList(), { 4.0 })[0]
        assertEquals(listOf(8), eine.cm)
        assertEquals(DruckPreis.Fest(4.0, Quelle.TREND), eine.preis)
    }

    @Test
    fun `drucke - Besitz ohne Seltenheit wird gezaehlt`() {
        val r = CardRow(id = "1", setCode = "LOB-DE005", language = "DE", name = "X", imageUrl = null, rarity = null, quantity = 2, price = 3.0)
        val d = ScanErgebnis.drucke(emptyList(), emptyList(), listOf(r), { null })
        assertEquals(2, d[0].anzahl)
        assertEquals(DruckPreis.Fest(3.0, Quelle.SAMMLUNG), d[0].preis)
    }

    // --- Spec 2026-11-03 §3.1: zusammengesetzter Druck kommt in die Liste ---

    private val enKnown = listOf(
        SetOption("MAMO-EN072", "Ultra Rare", 0.0, "EN"),
        SetOption("MAMO-EN072", "Secret Rare", 0.0, "EN"),
    )
    private val enKatalog = listOf(
        CatalogPrinting("MAMO-EN072", "Ultra Rare", null, false, cm = listOf(11)),
        CatalogPrinting("MAMO-EN072", "Secret Rare", null, false, cm = listOf(12)),
    )
    private val enTrends = mapOf(11 to 7.5, 12 to 30.0)
    private val zusammengesetzt = SetOption("MAMO-DE072", "Ultra Rare", 0.0, "DE", verified = false)

    @Test
    fun `drucke - zusammengesetzter DE-Druck kommt abgeleitet an die Spitze und bekommt cm vom EN-Zwilling`() {
        val match = SetCodeMatch.MatchResult(zusammengesetzt, listOf(zusammengesetzt), SetCodeMatch.MatchReason.MATCHED)
        val d = ScanErgebnis.drucke(enKnown, enKatalog, emptyList(), { enTrends[it] }, ScanErgebnis.zusatz(null, match))
        assertEquals(3, d.size)
        assertEquals("MAMO-DE072", d[0].setCode)
        assertTrue(d[0].abgeleitet)
        assertEquals(listOf(11), d[0].cm)
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND), d[0].preis)
        assertFalse(d[1].abgeleitet); assertFalse(d[2].abgeleitet)
        // Kopf bei sicherer Erkennung: fester Trend statt "–" (Ursache 1)
        val auswahl = ScanErgebnis.key("MAMO-DE072", "Ultra Rare", "DE")
        assertEquals(DruckPreis.Fest(7.5, Quelle.TREND),
            ScanErgebnis.kopfPreis(d, auswahl, true, false, ScanErgebnis.kandidaten(match, auswahl), null))
    }

    @Test
    fun `drucke - Kandidaten ausserhalb von known werden Zeilen, bekannte nicht doppelt`() {
        val k1 = SetOption("MAMO-DE072", "Ultra Rare", 0.0, "DE")
        val k2 = SetOption("MAMO-DE072", "Secret Rare", 0.0, "DE")
        val match = SetCodeMatch.MatchResult(null, listOf(k1, k2, enKnown[0]), SetCodeMatch.MatchReason.REGION_UNCLEAR)
        val d = ScanErgebnis.drucke(enKnown, enKatalog, emptyList(), { enTrends[it] }, ScanErgebnis.zusatz(null, match))
        assertEquals(listOf("MAMO-DE072|ultra rare|DE", "MAMO-DE072|secret rare|DE", "MAMO-EN072|ultra rare|EN", "MAMO-EN072|secret rare|EN"),
            d.map { ScanErgebnis.key(it.setCode, it.rarity, it.language) })
        assertEquals(DruckPreis.Fest(30.0, Quelle.TREND), d[1].preis)
    }

    @Test
    fun `drucke - zusatz mit Set-Code aus known ist nicht abgeleitet, Unknown nie eine Zeile`() {
        val andereSeltenheit = SetOption("MAMO-EN072", "Starlight Rare", 0.0, "EN")
        val unknown = SetOption("Unknown", "Unknown", 0.0, "DE")
        val match = SetCodeMatch.MatchResult(unknown, listOf(andereSeltenheit), SetCodeMatch.MatchReason.MATCHED)
        val d = ScanErgebnis.drucke(enKnown, enKatalog, emptyList(), { enTrends[it] }, ScanErgebnis.zusatz(null, match))
        assertEquals(3, d.size)
        assertEquals("Starlight Rare", d[0].rarity)
        assertFalse(d[0].abgeleitet)
        assertTrue(d.none { it.setCode == "Unknown" })
    }

    @Test
    fun `drucke - gewaehlter Druck bleibt in der Liste, auch wenn neue knownSets ihn nicht enthalten`() {
        val gewaehlt = SetOption("MAMO-DE072", "Secret Rare", 0.0, "DE")
        val match = SetCodeMatch.MatchResult(null, emptyList(), SetCodeMatch.MatchReason.NO_MATCH)
        val z = ScanErgebnis.zusatz(gewaehlt, match)
        assertEquals(listOf(gewaehlt), z)
        val d = ScanErgebnis.drucke(enKnown, enKatalog, emptyList(), { enTrends[it] }, z)
        assertEquals("MAMO-DE072|secret rare|DE", ScanErgebnis.key(d[0].setCode, d[0].rarity, d[0].language))
        assertEquals(DruckPreis.Fest(30.0, Quelle.TREND), d[0].preis)
    }

    @Test
    fun `zusatz - Reihenfolge gewaehlt, selected, Kandidaten`() {
        val g = SetOption("A-DE001", "Rare", 0.0, "DE")
        val s = SetOption("A-DE002", "Rare", 0.0, "DE")
        val k = SetOption("A-DE003", "Rare", 0.0, "DE")
        assertEquals(listOf(g, s, k), ScanErgebnis.zusatz(g, SetCodeMatch.MatchResult(s, listOf(k), SetCodeMatch.MatchReason.MATCHED)))
    }

    @Test
    fun `kandidaten - Schluessel der Kandidaten plus Auswahl`() {
        val k = SetOption("A-DE003", "Rare", 0.0, "DE")
        val m = SetCodeMatch.MatchResult(k, listOf(k), SetCodeMatch.MatchReason.MATCHED)
        assertEquals(setOf("A-DE003|rare|DE", "X|y|DE"), ScanErgebnis.kandidaten(m, "X|y|DE"))
        assertEquals(setOf("A-DE003|rare|DE"), ScanErgebnis.kandidaten(m, null))
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
        val d = ScanErgebnis.drucke(known, katalog, emptyList(), { trends[it] })
        val auswahl = ScanErgebnis.key("RA05-DE038", "Ultra Rare", "DE")
        val kand = known.take(2).map { ScanErgebnis.key(it.setCode, it.rarity, it.language) }.toSet()
        assertEquals(DruckPreis.Fest(12.4, Quelle.TREND), ScanErgebnis.kopfPreis(d, auswahl, true, false, emptySet(), null))
        assertEquals(DruckPreis.Spanne(12.4, 48.0, setOf(Quelle.TREND)), ScanErgebnis.kopfPreis(d, auswahl, false, false, kand, null))
        // ohne Treffer und ohne Auswahl: Spanne ueber alle Drucke
        assertEquals(DruckPreis.Spanne(12.4, 48.0, setOf(Quelle.TREND)), ScanErgebnis.kopfPreis(d.take(2), null, false, true, emptySet(), null))
    }

    // --- Spec 2026-11-03 §2.3: lowUndStand ---

    private val preise = CmPriceFile.Preise("2026-11-03", mapOf(1 to 12.4, 2 to 3.0), mapOf(1 to 9.0))
    private fun druck(cm: List<Int>, preis: DruckPreis.Preis, liveCm: List<Int> = emptyList()) =
        ScanErgebnis.Druck("A-DE001", "Rare", "DE", cm, 0, preis, null, liveCm = liveCm)

    @Test
    fun `lowUndStand - Tabelle`() {
        val trend = DruckPreis.Fest(12.4, Quelle.TREND)
        val m = druck(listOf(1), trend)
        assertEquals(9.0 to "2026-11-03", ScanErgebnis.lowUndStand(trend, m, true, preise, "2026-10-04T05:00:00Z"))
        // ID nicht in der Datei: low aus Live, Stand aus Live
        val live = DruckPreis.Fest(5.0, Quelle.LIVE)
        val ml = druck(listOf(7), live, liveCm = listOf(8))
        assertEquals(4.0 to "2026-11-02", ScanErgebnis.lowUndStand(live, ml, true, preise, null,
            liveLow = { if (it == 8) 4.0 else null }, livePriceDate = "2026-11-02"))
        // unsicher (nicht Zweig 1) -> kein low, Stand der Datei
        assertEquals(null to "2026-11-03", ScanErgebnis.lowUndStand(trend, m, false, preise, null))
        // Spanne -> kein low, ohne Datei Live-Datum
        val sp = DruckPreis.Spanne(1.0, 2.0)
        assertEquals(null to "2026-11-02", ScanErgebnis.lowUndStand(sp, null, false, null, null, livePriceDate = "2026-11-02"))
        // Richtwert aus Katalog -> Datumsteil von builtAt; live -> Live-Datum
        assertEquals(null to "2026-10-04", ScanErgebnis.lowUndStand(DruckPreis.Richtwert(0.09, true), m, true, preise, "2026-10-04T05:00:00Z"))
        assertEquals(null to "2026-11-02", ScanErgebnis.lowUndStand(DruckPreis.Richtwert(0.09, false), m, true, preise, null, livePriceDate = "2026-11-02"))
        // Sammlung, Keiner -> nichts
        assertEquals(null to null, ScanErgebnis.lowUndStand(DruckPreis.Fest(3.0, Quelle.SAMMLUNG), m, true, preise, "2026-10-04"))
        assertEquals(null to null, ScanErgebnis.lowUndStand(DruckPreis.Keiner, m, true, preise, "2026-10-04"))
    }

    @Test
    fun `abgeleitet - nur sicher, markiert abgeleitet und nicht getippt`() {
        val m = druck(listOf(1), DruckPreis.Fest(1.0, Quelle.TREND)).copy(abgeleitet = true)
        assertTrue(ScanErgebnis.abgeleitet(m, sicher = true, gewaehlt = false))
        assertFalse(ScanErgebnis.abgeleitet(m, sicher = true, gewaehlt = true))
        assertFalse(ScanErgebnis.abgeleitet(m, sicher = false, gewaehlt = false))
        assertFalse(ScanErgebnis.abgeleitet(null, sicher = true, gewaehlt = false))
    }

    @Test
    fun `hinweis - Texte und Bedingung`() {
        val m = druck(listOf(1), DruckPreis.Fest(1.0, Quelle.TREND))
        assertNull(ScanErgebnis.hinweis(m, sicher = true, gewaehlt = false))
        assertEquals("Druck nicht erkannt – tippe unten deinen Druck an.", ScanErgebnis.hinweis(null, sicher = true, gewaehlt = false))
        assertEquals("Mehrere Seltenheiten möglich – tippe unten deinen Druck an.", ScanErgebnis.hinweis(m, sicher = false, gewaehlt = false))
        val a = m.copy(abgeleitet = true)
        assertEquals("Druck abgeleitet – Seltenheit und Preis stammen vom selben Druck in anderer Sprache. " +
            "Tippe unten deinen Druck an, falls die Seltenheit nicht stimmt.", ScanErgebnis.hinweis(a, sicher = true, gewaehlt = false))
        assertNull(ScanErgebnis.hinweis(a, sicher = true, gewaehlt = true))
    }

    @Test
    fun `standText - erst ab 3 Tagen sichtbar`() {
        val heute = LocalDate.of(2026, 10, 4)
        assertNull(ScanErgebnis.standText("2026-10-02", heute))
        assertEquals("Stand 01.10.", ScanErgebnis.standText("2026-10-01", heute))
        assertNull(ScanErgebnis.standText(null, heute))
        assertNull(ScanErgebnis.standText("kaputt", heute))
    }

    // ---- Spec 2026-11-03 §4.4: die Nutzerauswahl bleibt ----
    private val basis = CardRow(id = "46986414", setCode = "Unknown", language = "DE", name = "X", imageUrl = null, rarity = null, quantity = 0, price = null)
    private fun scan(known: List<SetOption>, selected: SetOption?, edition: String = "first",
                     light: ScanConfidence.Light = ScanConfidence.Light.YELLOW) = ResolvedScan(
        basis, known, SetCodeMatch.MatchResult(selected, emptyList(), SetCodeMatch.MatchReason.REGION_UNCLEAR),
        ScanConfidence.Result(light, "Region unklar", edition, EditionEvidence.Confidence.LOW), "LOB-DE005")
    private val deUr = SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE")
    private val enUr = SetOption("LOB-EN005", "Ultra Rare", 3.5, "EN")

    @Test
    fun `nachUebernahme - nicht getippt folgt dem neuen Ergebnis`() {
        val alt = ScanErgebnis.Zustand(ScanErgebnis.key("LOB-EN005", "Ultra Rare", "EN"), false, null, "unlimited", false)
        val z = ScanErgebnis.nachUebernahme(alt, scan(listOf(deUr, enUr), deUr, edition = "first"), null)
        assertEquals(ScanErgebnis.key("LOB-DE005", "Ultra Rare", "DE"), z.auswahl)
        assertEquals("first", z.auflage)
        assertFalse(z.gewaehlt); assertNull(z.gewaehlterDruck); assertFalse(z.auflageGewaehlt)
        // ohne Treffer: Ersatzdruck der festen Sprache
        val z2 = ScanErgebnis.nachUebernahme(alt, scan(listOf(enUr, deUr), null), "DE")
        assertEquals(ScanErgebnis.key("LOB-DE005", "Ultra Rare", "DE"), z2.auswahl)
        // ohne Treffer und ohne feste Sprache: keine Auswahl
        assertNull(ScanErgebnis.nachUebernahme(alt, scan(listOf(enUr), null), null).auswahl)
    }

    @Test
    fun `nachUebernahme - getippte Auswahl und gewaehlte Auflage bleiben`() {
        val getippt = SetOption("LOB-EN005", "Ultra Rare", 0.0, "EN")
        val alt = ScanErgebnis.Zustand(ScanErgebnis.key("LOB-EN005", "Ultra Rare", "EN"), true, getippt, "limited", true)
        val z = ScanErgebnis.nachUebernahme(alt, scan(listOf(deUr), deUr, edition = "first"), null)
        assertEquals(alt, z)
        // getippt, Auflage nicht gewaehlt: Auflage folgt dem neuen Ergebnis
        val z2 = ScanErgebnis.nachUebernahme(alt.copy(auflageGewaehlt = false), scan(listOf(deUr), deUr, edition = "first"), null)
        assertEquals(alt.auswahl, z2.auswahl); assertSame(getippt, z2.gewaehlterDruck); assertEquals("first", z2.auflage)
    }

    @Test
    fun `beimTippen - setzt Auswahl, gewaehlt und gewaehlterDruck`() {
        val alt = ScanErgebnis.Zustand(null, false, null, "unlimited", false)
        val d = ScanErgebnis.Druck("LOB-DE005", "Ultra Rare", "DE", listOf(1), 0, DruckPreis.Fest(7.0, Quelle.TREND), null, abgeleitet = true)
        val z = ScanErgebnis.beimTippen(alt, d)
        assertEquals(ScanErgebnis.key("LOB-DE005", "Ultra Rare", "DE"), z.auswahl)
        assertTrue(z.gewaehlt)
        assertEquals(SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE"), z.gewaehlterDruck)
        assertEquals("unlimited", z.auflage); assertFalse(z.auflageGewaehlt)
    }

    @Test
    fun `uebernahme - Preis immer 0, abgeleiteter Druck geht hinaus, verbessert null`() {
        val r = scan(listOf(enUr), enUr)
        // Auswahl in knownSets: dieser Eintrag, aber mit price 0.0 (nie ein Netz-/Live-/Richtwert-Preis)
        val a = ScanErgebnis.uebernahme(r, null, ScanErgebnis.key("LOB-EN005", "Ultra Rare", "EN"), false, "first", false)
        assertEquals(enUr.copy(price = 0.0), a.match.selected)
        assertNull(a.verbessert)
        assertSame(r.base, a.base); assertSame(r.knownSets, a.knownSets); assertEquals("LOB-DE005", a.readSetCode)
        assertEquals(ScanConfidence.Light.YELLOW, a.confidence.light); assertEquals("Region unklar", a.confidence.reason)
        assertEquals(EditionEvidence.Confidence.LOW, a.confidence.editionConfidence)
        // abgeleiteter Druck (nicht in knownSets) mit Live-Preis: als SetOption mit 0.0
        val m = ScanErgebnis.Druck("LOB-DE005", "Ultra Rare", "DE", listOf(1), 0, DruckPreis.Fest(9.9, Quelle.LIVE), null,
            abgeleitet = true, liveCm = listOf(1))
        val b = ScanErgebnis.uebernahme(r, m, ScanErgebnis.key("LOB-DE005", "Ultra Rare", "DE"), true, "limited", true)
        assertEquals(SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE"), b.match.selected)
        assertEquals(ScanConfidence.Light.GREEN, b.confidence.light); assertNull(b.confidence.reason)
        assertEquals("limited", b.confidence.effectiveEdition)
        assertEquals(EditionEvidence.Confidence.HIGH, b.confidence.editionConfidence)
        assertNull(b.verbessert)
        // weder Auswahl noch markiert: der erkannte Druck
        assertEquals(enUr.copy(price = 0.0), ScanErgebnis.uebernahme(r, null, null, false, "first", false).match.selected)
    }

    // Review-Nachtrag 2 (03.11.): "In Sammlung +" (price 0.0) trifft den Stapel-Eintrag desselben Drucks (Netzpreis > 0).
    @Test
    fun `gleicherDruck - Preis und verified zaehlen nicht, Code Seltenheit Sprache schon`() {
        val stapel = SetOption("LOB-EN005", "Ultra Rare", 1.23, "EN", verified = true)
        assertTrue(ScanErgebnis.gleicherDruck(stapel, stapel.copy(price = 0.0, verified = false)))
        assertTrue(ScanErgebnis.gleicherDruck(stapel, SetOption("lob-en005", "ultra rare", 0.0, "en")))
        assertFalse(ScanErgebnis.gleicherDruck(stapel, stapel.copy(rarity = "Secret Rare")))
        assertFalse(ScanErgebnis.gleicherDruck(stapel, stapel.copy(language = "DE")))
        assertFalse(ScanErgebnis.gleicherDruck(stapel, null))
        assertTrue(ScanErgebnis.gleicherDruck(null, null))
    }

    // --- Spec 2026-11-03 §6.1/§3.1/§2.1: Live-Stufe ---

    @Test
    fun `liveKey - CodeKey und RarityNorm, sonst Rohcode gross und leere Seltenheit`() {
        assertEquals("LOB-1|ultrarare", ScanErgebnis.liveKey("LOB-DE001", "Ultra Rare"))
        assertEquals("LOB-1|ultrarare", ScanErgebnis.liveKey("lob-en001", "UR"))
        assertEquals("RA01-8|", ScanErgebnis.liveKey("RA01-DE008", "Unknown"))
        assertEquals("LOB DE005|common", ScanErgebnis.liveKey(" lob de005 ", "Common"))
    }

    private val liveMap = mapOf(
        "SD1-1|common" to CmResolveRepository.LiveCm("resolved", "unique", listOf(70)),
        "RA01-8|platinumsecretrare" to CmResolveRepository.LiveCm("ambiguous", null, listOf(71, 72)),
    )

    @Test
    fun `drucke - liveCm nur fuer europaeische Zeilen, JP mit gleichem liveKey nicht`() {
        val known = listOf(
            SetOption("SD1-EN001", "Common", 0.0, "EN"),
            SetOption("SD1-JP001", "Common", 0.0, "JP"),
            SetOption("SD1-KR001", "Common", 0.0, "KR"),
            SetOption("RA01-DE008", "Platinum Secret Rare", 0.0, "DE"),
        )
        val t = mapOf(70 to 2.5, 71 to 1.0, 72 to 30.0)
        val d = ScanErgebnis.drucke(known, emptyList(), emptyList(), { t[it] }, live = liveMap)
        assertEquals(listOf(70), d[0].liveCm); assertEquals(DruckPreis.Fest(2.5, Quelle.LIVE), d[0].preis)
        assertEquals(emptyList<Int>(), d[1].liveCm); assertEquals(DruckPreis.Keiner, d[1].preis)
        assertEquals(emptyList<Int>(), d[2].liveCm)
        assertEquals(DruckPreis.Spanne(1.0, 30.0, setOf(Quelle.LIVE)), d[3].preis)
    }

    @Test
    fun `drucke - eindeutiges Katalog-cm mit Trend schlaegt Live`() {
        val known = listOf(SetOption("SD1-EN001", "Common", 0.0, "EN"))
        val kat = listOf(CatalogPrinting("SD1-EN001", "Common", "EN", false, cm = listOf(5)))
        val d = ScanErgebnis.drucke(known, kat, emptyList(), { mapOf(5 to 1.1, 70 to 2.5)[it] }, live = liveMap)
        assertEquals(DruckPreis.Fest(1.1, Quelle.TREND), d[0].preis)
        assertEquals(listOf(70), d[0].liveCm)
    }

    private fun d(code: String, rarity: String, lang: String, cm: List<Int> = emptyList(),
                  preis: DruckPreis.Preis = DruckPreis.Keiner) = ScanErgebnis.Druck(code, rarity, lang, cm, 0, preis, null)

    @Test
    fun `liveBedarf - Reihenfolge markiert, Kandidaten, ohne JP KR Unknown Sammlung`() {
        val a = d("LOB-DE001", "Ultra Rare", "DE")
        val b = d("LOB-EN001", "Ultra Rare", "EN")                          // gleicher liveKey wie a -> einmal
        val c = d("RA01-DE008", "Secret Rare", "DE", cm = listOf(1, 2))
        val jp = d("SD1-JP001", "Common", "JP")
        val kr = d("SD1-KR001", "Common", "KR")
        val unk = d("Unknown", "Unknown", "DE")
        val samm = d("MAMO-DE072", "Rare", "DE", preis = DruckPreis.Fest(3.0, Quelle.SAMMLUNG))
        val rest = d("BLMR-DE001", "Rare", "DE")
        val alle = listOf(rest, jp, kr, unk, samm, b, c, a)
        val k = ScanErgebnis::key
        val kand = setOf(k(c.setCode, c.rarity, c.language), k(jp.setCode, jp.rarity, jp.language), k(kr.setCode, kr.rarity, kr.language),
            k(unk.setCode, unk.rarity, unk.language), k(samm.setCode, samm.rarity, samm.language), k(b.setCode, b.rarity, b.language))
        val mitKatalog = ScanErgebnis.liveBedarf(alle, k(a.setCode, a.rarity, a.language), kand, true, { false }, { null })
        assertEquals(listOf(a, c), mitKatalog)
        // ohne Katalog: alle uebrigen (europaeischen) dazu
        val ohne = ScanErgebnis.liveBedarf(alle, k(a.setCode, a.rarity, a.language), kand, false, { false }, { null })
        assertEquals(listOf(a, c, rest), ohne)
        // bekannt (Sitzungsspeicher) faellt weg
        assertEquals(listOf(c), ScanErgebnis.liveBedarf(alle, k(a.setCode, a.rarity, a.language), kand, true,
            { it == "LOB-1|ultrarare" }, { null }))
    }

    @Test
    fun `liveBedarf - cm size 1 mit Trend nicht, ohne Trend ja, hoechstens 10`() {
        val mitTrend = d("LOB-DE001", "Ultra Rare", "DE", cm = listOf(1))
        val ohneTrend = d("LOB-DE002", "Ultra Rare", "DE", cm = listOf(2))
        val r = ScanErgebnis.liveBedarf(listOf(mitTrend, ohneTrend), null, emptySet(), false, { false }, { if (it == 1) 4.0 else null })
        assertEquals(listOf(ohneTrend), r)
        val viele = (1..12).map { d("LOB-DE%03d".format(it), "Common", "DE") }
        assertEquals(10, ScanErgebnis.liveBedarf(viele, null, emptySet(), false, { false }, { null }).size)
    }

    @Test
    fun `zeilenText - drei Punkte nur europaeisch, suchend und ohne festen Preis`() {
        val suchend = setOf("LOB-1|ultrarare")
        assertEquals("…", ScanErgebnis.zeilenText(d("LOB-DE001", "Ultra Rare", "DE"), suchend))
        assertEquals("…", ScanErgebnis.zeilenText(d("LOB-DE001", "Ultra Rare", "DE", preis = DruckPreis.Spanne(1.0, 2.0)), suchend))
        assertEquals("…", ScanErgebnis.zeilenText(d("LOB-DE001", "Ultra Rare", "DE",
            preis = DruckPreis.Fest(1.0, Quelle.TREND, mehrdeutig = true)), suchend))
        assertEquals("2,00 €", ScanErgebnis.zeilenText(d("LOB-DE001", "Ultra Rare", "DE", preis = DruckPreis.Fest(2.0, Quelle.TREND)), suchend))
        assertEquals("–", ScanErgebnis.zeilenText(d("LOB-JP001", "Ultra Rare", "JP"), suchend))
        assertEquals("–", ScanErgebnis.zeilenText(d("LOB-DE001", "Ultra Rare", "DE"), emptySet()))
    }

    @Test
    fun `sucht und liveFehler - nur markierter Druck und Kandidaten, europaeisch`() {
        val m = d("LOB-DE001", "Ultra Rare", "DE")
        val kandidat = d("RA01-DE008", "Secret Rare", "DE")
        val anderer = d("BLMR-DE001", "Rare", "DE")
        val jp = d("SD1-JP001", "Common", "JP")
        val alle = listOf(m, kandidat, anderer, jp)
        val auswahl = ScanErgebnis.key(m.setCode, m.rarity, m.language)
        val kand = setOf(ScanErgebnis.key(kandidat.setCode, kandidat.rarity, kandidat.language),
            ScanErgebnis.key(jp.setCode, jp.rarity, jp.language))
        assertTrue(ScanErgebnis.sucht(alle, auswahl, kand, setOf("LOB-1|ultrarare")))
        assertTrue(ScanErgebnis.sucht(alle, null, kand, setOf("RA01-8|secretrare")))
        assertFalse(ScanErgebnis.sucht(alle, auswahl, kand, setOf("BLMR-1|rare")))
        assertFalse(ScanErgebnis.sucht(alle, auswahl, kand, setOf("SD1-1|common")))    // JP-Kandidat sucht nie
        assertTrue(ScanErgebnis.liveFehler(alle, auswahl, kand, setOf("LOB-1|ultrarare")) { false })
        assertFalse(ScanErgebnis.liveFehler(alle, auswahl, kand, setOf("LOB-1|ultrarare")) { true })   // schon im Speicher
        assertFalse(ScanErgebnis.liveFehler(alle, auswahl, kand, setOf("BLMR-1|rare")) { false })
    }
}

