package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogDb
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

    @Test fun `Import-Abfrage mit Passcodes samt Bild, ohne alle Karten ohne Bild`() {
        val (sql, args) = CatalogRepository.importRowsQuery(listOf("14558127", "23434538"))
        assertEquals("SELECT id, name_de, name_en, type, image FROM cards WHERE id IN (?,?)", sql)
        assertEquals(listOf("14558127", "23434538"), args.toList())
        val (all, none) = CatalogRepository.importRowsQuery(null)
        assertEquals("SELECT id, name_de, name_en, type, NULL FROM cards", all)
        assertEquals(0, none.size)
    }

    // Spec E3 §3: Banlist je Karte und Artwork-Zuordnung; ein Katalog von vor E3 bleibt lesbar (ohne Legalitaet).
    @Test fun `liest ban_tcg, ban_ocg und aliases, nur Zuordnungen auf Katalogkarten`() {
        val json = """{"version":8,"built_at":"2026-09-16T03:00:00.000Z","aliases":{"46986415":"46986414","99999998":"11111111"},"cards":[
          {"id":46986414,"name_de":"Dunkler Magier","name_en":"Dark Magician","type":"Normal Monster","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":null,"ban_ocg":null},
          {"id":55144522,"name_de":"Topf der Gier","name_en":"Pot of Greed","type":"Spell Card","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":"forbidden","ban_ocg":"semi"},
          {"id":18144506,"name_de":"H","name_en":"H","type":"Spell Card","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":"Unlimited"}]}"""
        val p = CatalogParser.parse(gz(json))
        assertEquals("2026-09-16T03:00:00.000Z", p.builtAt)
        assertTrue(p.hasLegality)
        assertEquals(mapOf("46986415" to "46986414"), p.aliases)
        assertEquals(listOf(null, "forbidden", null), p.cards.map { it.banTcg })
        assertEquals(listOf(null, "semi", null), p.cards.map { it.banOcg })
    }

    @Test fun `Katalog von vor E3 ohne aliases und Ban-Felder bleibt lesbar`() {
        val p = CatalogParser.parse(gz(sample))
        assertEquals(false, p.hasLegality)
        assertEquals(emptyMap<String, String>(), p.aliases)
        assertEquals(null, p.cards[0].banTcg)
        assertEquals(null, p.cards[0].banOcg)
    }

    @Test fun `Abfragen fuer Zuordnung und Legalitaet haben einen Platzhalter je Passcode`() {
        val (aliasSql, aliasArgs) = CatalogRepository.aliasesQuery(listOf("46986415", "1"))
        assertEquals("SELECT alt_id, card_id FROM card_aliases WHERE alt_id IN (?,?)", aliasSql)
        assertEquals(listOf("46986415", "1"), aliasArgs.toList())
        val (legSql, legArgs) = CatalogRepository.legalityQuery(listOf("46986414"))
        assertEquals("SELECT id, name_de, name_en, type, ban_tcg, ban_ocg FROM cards WHERE id IN (?)", legSql)
        assertEquals(listOf("46986414"), legArgs.toList())
    }

    // Spec E3 §9: v4 verwirft beim Upgrade den alten Katalog. Jede angelegte Tabelle muss in onUpgrade verworfen werden,
    // sonst scheitert onCreate beim naechsten Upgrade an "table already exists".
    @Test fun `CatalogDb v4 legt Ban-Spalten und card_aliases an und verwirft beim Upgrade jede Tabelle`() {
        assertEquals(4, CatalogDb.VERSION)
        val created = CatalogDb.CREATE_STATEMENTS.mapNotNull { Regex("^CREATE TABLE (\\w+)").find(it)?.groupValues?.get(1) }.toSet()
        val dropped = CatalogDb.DROP_STATEMENTS.mapNotNull { Regex("^DROP TABLE IF EXISTS (\\w+)$").find(it)?.groupValues?.get(1) }.toSet()
        assertEquals(setOf("cards", "printings", "meta", "sealed_products", "card_aliases"), created)
        assertEquals(created, dropped)
        assertTrue(CatalogDb.CREATE_STATEMENTS.first().contains("ban_tcg TEXT, ban_ocg TEXT"))
    }
}
