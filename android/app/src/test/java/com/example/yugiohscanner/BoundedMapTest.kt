package com.example.yugiohscanner

import com.example.yugiohscanner.ml.BoundedMap
import org.junit.Assert.assertEquals
import org.junit.Test

class BoundedMapTest {
    @Test fun `faellt der am laengsten unbenutzte Eintrag heraus`() {
        var created = 0
        val m = BoundedMap<String, Int>(2)
        m.getOrPut("a") { ++created }
        m.getOrPut("b") { ++created }
        m.getOrPut("a") { ++created }      // a frisch benutzt
        m.getOrPut("c") { ++created }      // b faellt heraus
        assertEquals(2, m.size)
        assertEquals(3, created)
        m.getOrPut("a") { ++created }      // noch da
        assertEquals(3, created)
        m.getOrPut("b") { ++created }      // neu angelegt
        assertEquals(4, created)
    }
}
