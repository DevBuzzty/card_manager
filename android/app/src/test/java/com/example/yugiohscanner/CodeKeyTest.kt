package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CodeKey
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec 2026-11-03 §3.2 -- geteilte Fixture docs/fixtures/code-key.json (Twin: Deno _shared/code-key_test.ts). */
class CodeKeyTest {
    @Test
    fun `alle Faelle der geteilten Fixture`() {
        val text = Fixtures.text("docs/fixtures/code-key.json")   // fehlt die Fixture: Test schlaegt fehl (Twin-Vertrag)
        val cases = JSONObject(text).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val erwartet = if (c.isNull("key")) null else c.getString("key")
            assertEquals(c.getString("in"), erwartet, CodeKey.of(c.getString("in")))
        }
    }

    @Test
    fun `Kernfaelle`() {
        assertEquals("LOB-5", CodeKey.of("LOB-DE005"))
        assertEquals("LOB-5", CodeKey.of("lob-g005"))
        assertEquals("LOB-5", CodeKey.of("LOB-005"))          // Region optional
        assertEquals("SGX3-A10", CodeKey.of("SGX3-DEA10"))
        assertEquals("RA01-0", CodeKey.of("RA01-DE000"))
        assertEquals("RA01-8", CodeKey.of(" ra01-en008 "))
        assertEquals("SD1-1", CodeKey.of("SD1-JP001"))
        assertEquals("B3-17", CodeKey.of("B3-17"))
        assertEquals(null, CodeKey.of("Unknown"))
        assertEquals(null, CodeKey.of(""))
        assertEquals(null, CodeKey.of("LOB DE005"))
    }
}
