package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.RarityNorm
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec 2026-11-03 §3.3 -- geteilte Fixture docs/fixtures/rarity-norm.json (Twin: Deno _shared/rarity-norm_test.ts). */
class RarityNormTest {
    @Test
    fun `alle Faelle der geteilten Fixture`() {
        val text = Fixtures.text("docs/fixtures/rarity-norm.json")   // fehlt die Fixture: Test schlaegt fehl (Twin-Vertrag)
        val f = JSONObject(text)
        val keys = f.getJSONArray("keys")
        for (i in 0 until keys.length()) {
            val c = keys.getJSONObject(i)
            val ein = if (c.isNull("in")) null else c.getString("in")
            val erwartet = if (c.isNull("key")) null else c.getString("key")
            assertEquals("key($ein)", erwartet, RarityNorm.key(ein))
        }
        val gleich = f.getJSONArray("gleich")
        for (i in 0 until gleich.length()) {
            val c = gleich.getJSONObject(i)
            assertEquals("gleich(${c.getString("a")}, ${c.getString("b")})", c.getBoolean("gleich"),
                RarityNorm.gleich(c.getString("a"), c.getString("b")))
        }
    }

    @Test
    fun `Kernfaelle`() {
        assertEquals("common", RarityNorm.key("C"))
        assertEquals("starfoilrare", RarityNorm.key("Starfoil"))
        assertEquals("platinumsecretrare", RarityNorm.key("PLatinum Secret Rare"))
        assertEquals("ultrararepharaohsrare", RarityNorm.key("Ultra Rare (Pharaoh's Rare)"))
        assertEquals("common", RarityNorm.key("Common<!--"))
        assertEquals("rare", RarityNorm.key("Rare-->"))
        assertEquals("shortprint", RarityNorm.key("Short Print"))
        assertEquals(null, RarityNorm.key("Unknown"))
        assertEquals(null, RarityNorm.key(null))
        assertEquals(null, RarityNorm.key("European & Oceanian debut"))
        assertEquals(null, RarityNorm.key("force-SMW"))
        assertEquals(true, RarityNorm.gleich("UR", "Ultra Rare"))
        assertEquals(false, RarityNorm.gleich("Unknown", "Unknown"))
        assertEquals(false, RarityNorm.gleich("Short Print", "Common"))
    }
}
