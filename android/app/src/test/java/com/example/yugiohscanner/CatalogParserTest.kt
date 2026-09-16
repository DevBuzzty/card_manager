package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogParser
import com.example.yugiohscanner.cloud.CatalogRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class CatalogParserTest {

    private fun gz(json: String): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }

    private val sample = """
    {"version":12,"built_at":"2026-09-06T03:00:00Z","cards":[
      {"id":46986414,"name_de":"Dunkler Magier","name_en":"Dark Magician","type":"Normal Monster",
       "desc_de":"Der ultimative Zauberer.","atk":2500,"def":2100,"level":7,
       "race":"Spellcaster","attribute":"DARK",
       "image":"https://x/a.jpg","image_small":"https://x/a_s.jpg",
       "printings":[{"code":"LOB-EN005","rarity":"Ultra Rare"}],
       "printings_verified":[{"code":"LOB-DE005","rarity":"Ultra Rare","lang":"DE"}]}
    ]}
    """.trimIndent()

    @Test fun `liest Version und Karte`() {
        val p = CatalogParser.parse(gz(sample))
        assertEquals(12, p.version)
        assertEquals(1, p.cards.size)
        val c = p.cards[0]
        assertEquals("46986414", c.id)
        assertEquals("Dunkler Magier", c.nameDe)
        assertEquals("Dark Magician", c.nameEn)
        assertEquals(2500, c.atk)
    }

    @Test fun `verified-Printings stehen vorn und sind markiert`() {
        val c = CatalogParser.parse(gz(sample)).cards[0]
        assertEquals(2, c.printings.size)
        assertEquals("LOB-DE005", c.printings[0].code)
        assertTrue(c.printings[0].verified)
        assertEquals("DE", c.printings[0].lang)
        assertEquals("LOB-EN005", c.printings[1].code)
        assertTrue(!c.printings[1].verified)
    }

    @Test fun `fehlende optionale Felder werden null, nicht 0`() {
        val json = """{"version":1,"built_at":"x","cards":[
          {"id":1,"name_de":"A","name_en":"A","type":"Spell Card","desc_de":"d",
           "image":"i","image_small":"s","printings":[],"printings_verified":[]}]}"""
        val c = CatalogParser.parse(gz(json)).cards[0]
        assertEquals(null, c.atk)
        assertEquals(null, c.def)
        assertEquals(null, c.level)
        assertEquals(0, c.printings.size)
    }

    @Test fun `eine kaputte Karte kippt nicht den ganzen Katalog`() {
        val json = """{"version":3,"built_at":"x","cards":[
          {"nope":true},
          {"id":2,"name_de":"B","name_en":"B","type":"t","desc_de":"d",
           "image":"i","image_small":"s","printings":[],"printings_verified":[]}]}"""
        val p = CatalogParser.parse(gz(json))
        assertEquals(3, p.version)
        assertEquals(1, p.cards.size)
        assertEquals("2", p.cards[0].id)
    }

    // Spec E1 §5: Katalog ab Version 6 traegt cm_price; fehlt oder <= 0 -> null.
    @Test fun `liest cm_price ab Katalog 6, null und 0 werden null`() {
        val json = """{"version":6,"built_at":"x","cards":[
          {"id":1,"name_de":"A","name_en":"A","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":35.71},
          {"id":2,"name_de":"B","name_en":"B","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":null},
          {"id":3,"name_de":"C","name_en":"C","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":0}]}"""
        val cards = CatalogParser.parse(gz(json)).cards
        assertEquals(35.71, cards[0].cmPrice!!, 1e-9)
        assertEquals(null, cards[1].cmPrice)
        assertEquals(null, cards[2].cmPrice)
    }

    @Test fun `Katalog 5 ohne cm_price bleibt lesbar`() {
        val c = CatalogParser.parse(gz(sample)).cards[0]
        assertEquals("Dunkler Magier", c.nameDe)
        assertEquals(null, c.cmPrice)
    }

    @Test fun `Preisabfrage hat einen Platzhalter je Passcode`() {
        val (sql, args) = CatalogRepository.cmPriceQuery(listOf("14558127", "23434538"))
        assertEquals("SELECT id, cm_price FROM cards WHERE id IN (?,?)", sql)
        assertEquals(listOf("14558127", "23434538"), args.toList())
    }
}
