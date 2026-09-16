package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogDb
import com.example.yugiohscanner.cloud.CatalogParser
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogSealedProduct
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * Spec G3 §3/§10 -- CatalogDb v2 auf der JVM: Parser, Schema-Version und die reinen Suchargumente. Der
 * SQLite-Rundlauf (Import und Suche) steht in androidTest/CatalogDbTest und in der Geraete-Abnahme.
 */
class CatalogSealedTest {

    private fun gz(json: String): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }

    @Test fun `Katalog-Schema ist Version 4`() {
        // Spec E3 §3: v4 bringt ban_tcg/ban_ocg und card_aliases (v3 brachte cards.cm_price, v2 sealed_products).
        assertEquals(4, CatalogDb.VERSION)
    }

    @Test fun `liest sealed_products, unbekannte Art wird other, Trend 0 wird null, kaputte Eintraege fallen weg`() {
        val json = """{"version":14,"built_at":"2026-09-15T03:00:00Z","cards":[],"sealed_products":[
          {"cm_product_id":254469,"name":"Metal Raiders Booster Box","kind":"display","trend":499.29},
          {"cm_product_id":230006,"name":"Force of the Breaker Booster","kind":"booster","trend":null},
          {"cm_product_id":999001,"name":"Beispiel-Turnierticket","kind":"karton","trend":0},
          {"cm_product_id":0,"name":"ohne gültige ID","kind":"booster","trend":1.0},
          {"name":"ohne ID","kind":"booster","trend":1.0},
          {"cm_product_id":230007,"name":"","kind":"booster","trend":46.11}
        ]}"""
        assertEquals(
            listOf(
                CatalogSealedProduct(254469L, "Metal Raiders Booster Box", "display", 499.29),
                CatalogSealedProduct(230006L, "Force of the Breaker Booster", "booster", null),
                CatalogSealedProduct(999001L, "Beispiel-Turnierticket", "other", null),
            ),
            CatalogParser.parse(gz(json)).sealedProducts,
        )
    }

    @Test fun `alter Katalog ohne sealed_products ergibt eine leere Liste`() {
        val json = """{"version":13,"built_at":"x","cards":[]}"""
        assertTrue(CatalogParser.parse(gz(json)).sealedProducts.isEmpty())
    }

    @Test fun `Sealed-Suche escaped LIKE-Zeichen, sortiert nach Name, hoechstens 50`() {
        val (sql, args) = CatalogRepository.sealedSearchQuery("  100%_Box\\ ")
        assertEquals(
            "SELECT cm_product_id, name, kind, trend FROM sealed_products WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?",
            sql,
        )
        assertEquals(listOf("%100\\%\\_Box\\\\%", "50"), args.toList())
        assertEquals("7", CatalogRepository.sealedSearchQuery("x", 7).second[1])
    }
}
