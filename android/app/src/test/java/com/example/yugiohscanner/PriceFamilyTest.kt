package com.example.yugiohscanner

import com.example.yugiohscanner.ml.PriceFamily
import com.example.yugiohscanner.ml.UtcDay
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PriceFamilyTest {
    @Test fun `Zuordnung gleicht desktop price-families json`() {
        val json = JSONObject(Fixtures.text("desktop/electron/price-families.json"))
        val fromJson = json.keys().asSequence().associateWith { json.getString(it) }
        assertEquals(fromJson, PriceFamily.BY_SOURCE)
    }

    @Test fun `Familie aus Quelle und Sperre`() {
        assertEquals("cm", PriceFamily.ofSource("cloud"))
        assertEquals("unknown", PriceFamily.ofSource("import"))
        assertEquals("unknown", PriceFamily.ofSource(null))
        assertEquals("ygo", PriceFamily.ofLock(null))
        assertEquals("ygo", PriceFamily.ofLock(0))
        assertEquals("cm", PriceFamily.ofLock(1))
        assertEquals("manual", PriceFamily.ofLock(2))
        assertEquals("unknown", PriceFamily.ofLock(7))
    }

    @Test fun `Tage in UTC und deutsches Kurzdatum`() {
        assertEquals("2026-08-21", UtcDay.add("2026-09-20", -30))
        assertEquals("2027-01-01", UtcDay.add("2026-12-31", 1))
        assertEquals("23.09.", UtcDay.formatDe("2026-09-23"))
    }
}
