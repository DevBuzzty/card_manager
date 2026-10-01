package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SetCodeMatchFesteSpracheTest {
    private val en = SetOption("CORI-EN001", "Super Rare", 0.0, "EN")
    private val de = SetOption("CORI-DE001", "Super Rare", 0.0, "DE", verified = true)
    private val kr = SetOption("CORI-KR001", "Super Rare", 0.0, "KR")

    @Test fun `fest KR waehlt den vorhandenen KR-Druck, auch wenn EN gelesen wurde`() {
        val r = SetCodeMatch.best(listOf("CORI-EN001"), listOf(de, en, kr), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, r.reason)
    }

    @Test fun `fest KR ohne KR-Druck setzt den Code zusammen, unverifiziert`() {
        val r = SetCodeMatch.best(listOf("CORI-DE001"), listOf(de, en), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
        assertEquals("Super Rare", r.selected?.rarity)
        assertFalse(r.selected!!.verified)
    }

    @Test fun `fest DE schlaegt eine gelesene EN-Region`() {
        val r = SetCodeMatch.best(listOf("CORI-EN001", "CORI-EN001"), listOf(de, en), festeSprache = "DE")
        assertEquals("CORI-DE001", r.selected?.setCode)
    }

    @Test fun `fest KR schlaegt den deutschen Sprachhinweis aus dem Kartentext`() {
        val text = "Wenn diese Karte auf den Friedhof gelegt wird, kannst du eine Karte deiner Hand"
        val r = SetCodeMatch.best(listOf("CORI-DE001", text), listOf(de, en, kr), listOf("CORI-DE001", text), festeSprache = "KR")
        assertEquals("CORI-KR001", r.selected?.setCode)
    }

    @Test fun `fest KR ohne lesbares Kuerzel bleibt NO_MATCH`() {
        val r = SetCodeMatch.best(listOf("xx zz"), listOf(de, en, kr), festeSprache = "KR")
        assertNull(r.selected)
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, r.reason)
    }

    @Test fun `Auto mit gelesener KR-Region waehlt KR`() {
        val r = SetCodeMatch.best(listOf("CORI-KR001", "CORI-KR001"), listOf(de, en, kr))
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
    }

    @Test fun `Auto mit KR-Region ohne KR-Druck setzt KR zusammen`() {
        val r = SetCodeMatch.best(listOf("CORI-KR001", "CORI-KR001"), listOf(de, en))
        assertEquals("CORI-KR001", r.selected?.setCode)
        assertEquals("KR", r.selected?.language)
    }

    @Test fun `ScanSprache startet auf Auto und kennt die Regionen`() {
        assertNull(com.example.yugiohscanner.ml.ScanSprache.fest)
        assertEquals("KR", com.example.yugiohscanner.ml.ScanSprache.region("KR"))
        assertEquals("DE", com.example.yugiohscanner.ml.ScanSprache.region("DE"))
    }
}
