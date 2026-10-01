package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.LanguageKr
import com.example.yugiohscanner.ml.RegionToken
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Zwilling von desktop/electron/language-kr.test.cjs -- beide lesen docs/fixtures/language/kr.json. */
class LanguageKrTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/language/kr.json"))

    @Test fun `Standardfaktor laut Fixture`() {
        assertEquals(fix.getDouble("default_factor"), LanguageKr.DEFAULT_FACTOR, 0.0)
    }

    @Test fun `Region auf Sprache laut Fixture`() {
        val a = fix.getJSONArray("region_language")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(p.getString(0), p.getString(1), RegionToken.language(p.getString(0)))
        }
    }

    @Test fun `isKoreanCode laut Fixture`() {
        val a = fix.getJSONArray("korean_code")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(p.getString(0), p.getBoolean(1), LanguageKr.isKoreanCode(p.getString(0)))
        }
    }

    @Test fun `applyFactor laut Fixture`() {
        val a = fix.getJSONArray("apply_factor")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            val price = if (p.isNull(0)) null else p.getDouble(0)
            val f = if (p.isNull(1)) null else p.getDouble(1)
            val want = if (p.isNull(2)) null else p.getDouble(2)
            assertEquals("$price x $f", want, LanguageKr.applyFactor(price, f))
        }
    }

    @Test fun `extractKoName laut Fixture`() {
        val a = fix.getJSONArray("ko_name")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(if (p.isNull(1)) null else p.getString(1), LanguageKr.extractKoName(p.getString(0)))
        }
    }

    @Test fun `konamiTitleName laut Fixture`() {
        val a = fix.getJSONArray("konami_title")
        for (i in 0 until a.length()) {
            val p = a.getJSONArray(i)
            assertEquals(if (p.isNull(1)) null else p.getString(1), LanguageKr.konamiTitleName(p.getString(0)))
        }
    }

    @Test fun `belongsTo KR nimmt nur KR-Codes`() {
        val kr = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("KR")
        assertEquals(listOf("SYE-KR001", "LOB-K005"), listOf("SYE-KR001", "LOB-K005", "DOOD-EN001", "LOB-DE005").filter(kr))
        val de = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("DE")
        assertEquals(listOf("LOB-DE005", "TP1-G015"), listOf("LOB-DE005", "TP1-G015", "SYE-KR001").filter(de))
        val jp = com.example.yugiohscanner.cloud.PrintingRepository.belongsTo("JP")
        assertEquals(listOf("B3-17"), listOf("B3-17", "SYE-KR001").filter(jp))
    }
}
