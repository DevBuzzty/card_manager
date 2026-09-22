package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListingSavedPartially
import com.example.yugiohscanner.cloud.ListingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Spec H3a Abweichung 1 -- ListingsRepository.create schreibt erst die Angebote (Netz), dann for_sale. Der zweite Schritt
 * ist als forSaleAfterCreate herausgelöst, damit der Teilerfolg ohne Server prüfbar ist: ListingSheet erkennt ihn am Typ.
 */
class ListingCreatePartialTest {
    @Test fun `for_sale gesetzt -- die neuen ids kommen zurueck`() = runBlocking {
        var got: List<String>? = null
        assertEquals(listOf("L1"), ListingsRepository.forSaleAfterCreate(listOf("L1"), listOf("c1", "c2")) { got = it })
        assertEquals(listOf("c1", "c2"), got)
    }

    @Test fun `for_sale scheitert -- ListingSavedPartially mit Meldung`() = runBlocking {
        try {
            ListingsRepository.forSaleAfterCreate(listOf("L1"), listOf("c1")) { throw RuntimeException("Netz weg") }
            fail("erwartet ListingSavedPartially")
        } catch (e: ListingSavedPartially) {
            assertEquals("Angebot gespeichert, „Zum Verkauf“ nicht gesetzt: Netz weg", e.message)
            assertTrue(e is IllegalStateException)
        }
    }

    @Test fun `Abbruch bleibt Abbruch`() = runBlocking {
        try {
            ListingsRepository.forSaleAfterCreate(listOf("L1"), listOf("c1")) { throw CancellationException("weg") }
            fail("erwartet CancellationException")
        } catch (e: ListingSavedPartially) {
            fail("Abbruch darf kein Teilerfolg sein")
        } catch (_: CancellationException) { }
    }
}
