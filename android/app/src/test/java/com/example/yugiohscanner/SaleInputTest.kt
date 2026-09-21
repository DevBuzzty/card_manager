package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SaleInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SaleInputTest {
    @Test fun kommaUndPunkt() {
        assertEquals(12.5, SaleInput.parseMoney("12,50")!!, 0.0)
        assertEquals(12.5, SaleInput.parseMoney(" 12.5 ")!!, 0.0)
        assertEquals(3.0, SaleInput.parseMoney("3")!!, 0.0)
        assertEquals(0.0, SaleInput.parseMoney("0")!!, 0.0)
    }

    @Test fun leerUndUngueltig() {
        assertNull(SaleInput.parseMoney(""))
        assertNull(SaleInput.parseMoney("   "))
        assertNull(SaleInput.parseMoney(null))
        assertNull(SaleInput.parseMoney("-1"))
        assertNull(SaleInput.parseMoney("1,234"))
        assertNull(SaleInput.parseMoney("abc"))
        assertNull(SaleInput.parseMoney("1.000,00"))
        assertNull(SaleInput.parseMoney(","))
    }

    @Test fun pflichtfeld() {
        assertFalse(SaleInput.moneyOk("", required = true))
        assertTrue(SaleInput.moneyOk("", required = false))
        assertTrue(SaleInput.moneyOk("  ", required = false))
        assertTrue(SaleInput.moneyOk("4,99", required = true))
        assertFalse(SaleInput.moneyOk("-2", required = false))
        assertFalse(SaleInput.moneyOk("x", required = false))
    }

    @Test fun vorbelegung() {
        assertEquals("12,50", SaleInput.centsInput(1250))
        assertEquals("0,05", SaleInput.centsInput(5))
        assertEquals("0,00", SaleInput.centsInput(0))
        assertEquals("1234,00", SaleInput.centsInput(123400))
        // Rundreise: Vorbelegung ist wieder gueltige Eingabe mit demselben Centwert.
        assertEquals(1250L, Math.round(SaleInput.parseMoney(SaleInput.centsInput(1250))!! * 100))
    }

    @Test fun datum() {
        assertTrue(SaleInput.dateOk("2026-09-21"))
        assertFalse(SaleInput.dateOk("2026-9-21"))
        assertFalse(SaleInput.dateOk("2026-13-01"))
        assertFalse(SaleInput.dateOk("2026-02-30"))
        assertFalse(SaleInput.dateOk(""))
        assertFalse(SaleInput.dateOk(null))
    }
}
