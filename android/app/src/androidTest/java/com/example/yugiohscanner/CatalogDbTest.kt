package com.example.yugiohscanner

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogDb
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.ParsedCatalog
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs on-device against a real SQLite file (CatalogDb targets a fixed "catalog.db", same as
 * production), so the whole scenario lives in one test to avoid two SQLiteOpenHelper instances
 * (this test's [db] and the [CatalogRepository] singleton's) racing over deleting/recreating that
 * file between test methods.
 */
@RunWith(AndroidJUnit4::class)
class CatalogDbTest {

    private lateinit var context: Context
    private lateinit var db: CatalogDb

    private fun darkMagician() = CatalogCard(
        id = "46986414",
        nameDe = "Dunkler Magier",
        nameEn = "Dark Magician",
        type = "Normal Monster",
        descDe = "Der ultimative Zauberer.",
        atk = 2500,
        def = 2100,
        level = 7,
        race = "Spellcaster",
        attribute = "DARK",
        image = "https://x/a.jpg",
        imageSmall = "https://x/a_s.jpg",
        printings = listOf(
            CatalogPrinting(code = "LOB-DE005", rarity = "Ultra Rare", lang = "DE", verified = true),
            CatalogPrinting(code = "LOB-EN005", rarity = "Ultra Rare", lang = null, verified = false)
        )
    )

    private fun blueEyes() = CatalogCard(
        id = "89631139",
        nameDe = "Blauäugiger weißer Drache",
        nameEn = "Blue-Eyes White Dragon",
        type = "Normal Monster",
        descDe = "Ein Drache mit ungeheurer Kraft.",
        atk = 3000,
        def = 2500,
        level = 8,
        race = "Dragon",
        attribute = "LIGHT",
        image = "https://x/b.jpg",
        imageSmall = "https://x/b_s.jpg",
        printings = listOf(
            CatalogPrinting(code = "LOB-DE001", rarity = "Ultra Rare", lang = "DE", verified = true)
        )
    )

    private fun catalog(version: Int, cards: List<CatalogCard>) =
        ParsedCatalog(version = version, builtAt = "2026-09-06T00:00:00Z", cards = cards)

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("catalog.db")
        db = CatalogDb(context)
        CatalogRepository.init(context)
    }

    @After
    fun tearDown() {
        db.close()
        context.deleteDatabase("catalog.db")
    }

    @Test
    fun importReadReplaceAndAtomicRollback() {
        // Import eines kleinen Katalogs -> version() und cardCount() stimmen.
        db.importAll(catalog(12, listOf(darkMagician(), blueEyes())))
        assertEquals(12, db.version())
        assertEquals(2, db.cardCount())

        // card("46986414") liefert die Karte mit deutschem Namen.
        val card = CatalogRepository.card("46986414")
        assertNotNull(card)
        assertEquals("Dunkler Magier", card!!.nameDe)

        // printings("46986414") liefert die verified-Zeile zuerst.
        val printings = CatalogRepository.printings("46986414")
        assertEquals(2, printings.size)
        assertTrue(printings[0].verified)
        assertEquals("LOB-DE005", printings[0].code)
        assertFalse(printings[1].verified)
        assertEquals("LOB-EN005", printings[1].code)

        // search("Dunkler") findet die Karte; search("zzz") liefert leer.
        assertTrue(CatalogRepository.search("Dunkler").any { it.id == "46986414" })
        assertTrue(CatalogRepository.search("zzz").isEmpty())

        // Zweiter Import mit anderer Version ersetzt vollstaendig.
        db.importAll(catalog(13, listOf(blueEyes())))
        assertEquals(13, db.version())
        assertEquals(1, db.cardCount())
        assertNull(CatalogRepository.card("46986414"))
        assertNotNull(CatalogRepository.card("89631139"))

        // Ein Import, der mitten drin wirft (doppelte id -> PRIMARY KEY-Verletzung), laesst
        // Version und Inhalt des vorherigen Imports unangetastet.
        var threw = false
        try {
            db.importAll(catalog(99, listOf(blueEyes(), blueEyes())))
        } catch (e: Exception) {
            threw = true
        }
        assertTrue("importAll sollte bei doppelter id werfen", threw)
        assertEquals(13, db.version())
        assertEquals(1, db.cardCount())
        assertNotNull(CatalogRepository.card("89631139"))
    }
}
