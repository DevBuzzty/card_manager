package com.example.yugiohscanner

import com.example.yugiohscanner.ui.PendingForSale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Spec I §5.2 Punkt 3: Vormerkung gilt in der Anzeige ab dem Tippen, bis der Abgleich (oder ein Fehler) sie aufloest. */
class PendingForSaleTest {
    @Test fun `setzen, dann aufloesen`() {
        PendingForSale.set(listOf("a", "b"), true)
        assertEquals(true, PendingForSale.state.value["a"])
        assertEquals(true, PendingForSale.state.value["b"])
        PendingForSale.clear(listOf("a"))
        assertNull(PendingForSale.state.value["a"])
        assertEquals(true, PendingForSale.state.value["b"])
        PendingForSale.clear(listOf("b"))
        assertEquals(emptyMap<String, Boolean>(), PendingForSale.state.value)
    }

    @Test fun `spaeterer Wert ersetzt den frueheren`() {
        PendingForSale.set(listOf("c"), true)
        PendingForSale.set(listOf("c"), false)
        assertEquals(false, PendingForSale.state.value["c"])
        PendingForSale.clear(listOf("c"))
    }
}
