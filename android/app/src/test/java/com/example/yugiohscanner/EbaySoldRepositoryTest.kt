package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbaySoldRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EbaySoldRepositoryTest {
    @Test
    fun `Zeile aus PostgREST-Array, Zahlen als Text, Belege`() {
        val r = EbaySoldRepository.parseRow("""[{"status":"ok","median_all":"7.5","n_all":12,"median_first":null,"n_first":0,
            "last_sold_at":"2026-09-28T14:03:00+00:00","sales":[{"title":"SDJ-G001","price":6,"sold_at":"2026-09-28T14:03:00Z","url":"https://www.ebay.de/itm/1","first":false}]}]""")!!
        assertEquals("ok", r.status); assertEquals(7.5, r.medianAll!!, 0.0); assertEquals(12, r.nAll)
        assertNull(r.medianFirst); assertEquals(1, r.sales.size); assertEquals(6.0, r.sales[0].price, 0.0)
        assertEquals("https://www.ebay.de/itm/1", r.sales[0].url)
    }

    @Test
    fun `leeres Array oder Unsinn gibt null`() {
        assertNull(EbaySoldRepository.parseRow("[]"))
        assertNull(EbaySoldRepository.parseRow("kein json"))
    }

    @Test
    fun `Zugangsstatus`() {
        assertEquals("fehlt", EbaySoldRepository.parseAccess("""[{"access":"fehlt"}]"""))
        assertEquals("unbekannt", EbaySoldRepository.parseAccess("[]"))
        assertEquals("unbekannt", EbaySoldRepository.parseAccess("""[{"access":"komisch"}]"""))
    }
}
