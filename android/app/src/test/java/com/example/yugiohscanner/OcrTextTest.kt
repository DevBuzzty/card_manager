package com.example.yugiohscanner

import com.example.yugiohscanner.ml.OcrText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [OcrText.findPasscode]'s catalog gate (Task 9 / Spec D SS7c): the correction pass (step 2) may
 * only accept an 8-digit result the catalog actually recognises, so a confusable-character fix
 * can't invent a passcode that was never real. [CatalogRepository.card] is Android/SQLite-backed
 * and needs no seam of its own here -- `exists` is the seam, a plain lambda a JVM test can fake.
 */
class OcrTextTest {

    @Test fun `exakter 8-stelliger Lauf braucht keine Katalog-Pruefung`() {
        // Step 1 (fast path) never rewrites anything, so `exists` isn't even consulted.
        assertEquals(12345678, OcrText.findPasscode("12345678", exists = { false }))
    }

    @Test fun `Korrektur wird akzeptiert wenn der Katalog die Karte kennt`() {
        // "I" corrects to '1' inside an otherwise-numeric token.
        assertEquals(12345678, OcrText.findPasscode("I2345678", exists = { it == "12345678" }))
    }

    @Test fun `Korrektur wird verworfen wenn die entstandene Karte nicht existiert`() {
        // Same OCR noise, but the catalog says this passcode has never existed -- an aggressive
        // confusion fix must not invent it.
        assertNull(OcrText.findPasscode("I2345678", exists = { false }))
    }

    @Test fun `ohne uebergebene Pruefung bleibt das bisherige Verhalten erhalten`() {
        // Default `exists` is always-true, so callers that haven't wired the catalog yet keep
        // today's behaviour.
        assertEquals(12345678, OcrText.findPasscode("I2345678"))
    }

    @Test fun `zu kurze oder nicht-numerische Tokens werden ignoriert`() {
        assertNull(OcrText.findPasscode("Spezialbeschwoerung", exists = { true }))
    }
}
