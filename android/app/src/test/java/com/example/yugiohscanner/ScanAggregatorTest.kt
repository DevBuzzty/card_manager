package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ui.ScanAggregator
import org.junit.Assert.assertEquals
import org.junit.Test

class ScanAggregatorTest {

    private fun set(code: String, rarity: String = "Common", lang: String = "DE") =
        SetOption(setCode = code, rarity = rarity, price = 0.0, language = lang)

    private val lob = set("LOB-DE005")
    private val sdy = set("SDY-G005")

    @Test
    fun `ohne gelesenen Setcode zaehlt der Hauptdruck`() {
        // Spec-Tabelle, letzte Zeile: eine Karte, deren Code nicht gelesen wurde, ist
        // wahrscheinlich dieselbe wie eben -- nicht eine neue unbekannte.
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = null),
        )
    }

    @Test
    fun `gleicher Druck wie der Hauptdruck zaehlt den Hauptdruck`() {
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = set("LOB-DE005")),
        )
    }

    @Test
    fun `bekannter Zusatzdruck wird getroffen`() {
        val result = ScanAggregator.target(
            primary = lob, extras = listOf(sdy), scanned = set("SDY-G005"),
        )
        assertEquals(ScanAggregator.Target.Extra(0), result)
    }

    @Test
    fun `der richtige unter mehreren Zusatzdrucken wird getroffen`() {
        val en = set("LOB-EN005", lang = "EN")
        val result = ScanAggregator.target(
            primary = lob, extras = listOf(sdy, en), scanned = set("LOB-EN005", lang = "EN"),
        )
        assertEquals(ScanAggregator.Target.Extra(1), result)
    }

    @Test
    fun `unbekannter Druck wird ein neuer Zusatzdruck`() {
        val neu = set("SYE-DE001")
        assertEquals(
            ScanAggregator.Target.NewExtra(neu),
            ScanAggregator.target(primary = lob, extras = listOf(sdy), scanned = neu),
        )
    }

    @Test
    fun `noch nicht aufgeloester Hauptdruck zaehlt den Hauptdruck`() {
        // Wettlauf aus Spec Paragraf 4: die Wiederholung trifft ein, waehrend der erste Scan
        // derselben Karte noch auflöst. Es gibt nichts, wogegen verglichen werden koennte.
        assertEquals(
            ScanAggregator.Target.Primary,
            ScanAggregator.target(primary = null, extras = emptyList(), scanned = lob),
        )
    }

    @Test
    fun `gleicher Setcode mit anderer Rarity ist ein anderer Druck`() {
        // Die Sammlung schluesselt auf (id, set_code, language, rarity) -- ein Secret Rare in
        // einen Common zu falten schriebe den falschen Preis fort.
        val secret = set("LOB-DE005", rarity = "Secret Rare")
        assertEquals(
            ScanAggregator.Target.NewExtra(secret),
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = secret),
        )
    }

    @Test
    fun `gleicher Setcode in anderer Sprache ist ein anderer Druck`() {
        val en = set("LOB-DE005", lang = "EN")
        assertEquals(
            ScanAggregator.Target.NewExtra(en),
            ScanAggregator.target(primary = lob, extras = emptyList(), scanned = en),
        )
    }

    @Test
    fun `ein noch leerer Zusatzdruck wird uebersprungen statt getroffen`() {
        // extraPrintings.selectedSet ist nullbar (der Nutzer kann eine Zeile aufmachen, ohne
        // schon zu waehlen). Eine leere Zeile darf kein Ziel sein.
        assertEquals(
            ScanAggregator.Target.NewExtra(sdy),
            ScanAggregator.target(primary = lob, extras = listOf(null), scanned = sdy),
        )
    }
}
