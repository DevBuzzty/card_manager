package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SetCodeOcr
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Grammar post-processing for set codes (Task 9 / Spec D "Massnahme 3"). The eight `SDSE-...`
 * and `L5DD-...`/`I5DD-...`/`1SDD-...`/`LSDD-...` strings are real OCR output captured on-device
 * from ten cards (see task-9 brief); the rest pin the widened grammar (single-letter region,
 * a variant letter before the number) and a negative control.
 *
 * The prefix (before the hyphen) is deliberately left uncorrected: real prefixes legitimately end
 * in digits (RA01, SGX3), so there is no grammar rule that tells a genuine digit there apart from
 * a misread letter. Correcting it anyway (e.g. folding 'I' into 'L') would risk mangling a real
 * code like IOC-EN001 into LOC-EN001 -- a wrong-but-confident set code is worse than a partially
 * corrected one (see the "never invent a code" rule in the brief). Only the region+number side of
 * the hyphen has an unambiguous letters-then-digits grammar, so only that side is corrected.
 */
class SetCodeOcrTest {

    @Test fun `sauberer Code bleibt unveraendert`() {
        assertEquals(listOf("SDSE-DE024"), SetCodeOcr.extract("SDSE-DE024"))
    }

    @Test fun `O vor der Nummer wird zu 0 korrigiert`() {
        assertEquals(listOf("SDSE-DE035"), SetCodeOcr.extract("SDSE-DEO35"))
    }

    @Test fun `O vor der Nummer wird zu 0 korrigiert (zweiter Beleg)`() {
        assertEquals(listOf("SDSE-DE015"), SetCodeOcr.extract("SDSE-DEO15"))
    }

    @Test fun `Y vor der Nummer wird zu 1 korrigiert, Praefix bleibt roh`() {
        // Ground truth ist LSDD-DE125 (5 fuer S, Y fuer 1) -- das Praefix "L5DD" wird bewusst NICHT
        // angefasst, siehe Klassenkommentar. Region+Nummer wird voll korrigiert.
        assertEquals(listOf("L5DD-DE125"), SetCodeOcr.extract("L5DD-DEY25"))
    }

    @Test fun `dieselbe Karte mit I statt L im Praefix -- Praefix bleibt roh`() {
        assertEquals(listOf("I5DD-DE125"), SetCodeOcr.extract("I5DD-DEY25"))
    }

    @Test fun `1 statt L im Praefix -- Praefix bleibt roh, Y wird korrigiert`() {
        assertEquals(listOf("1SDD-DE121"), SetCodeOcr.extract("1SDD-DEY21"))
    }

    @Test fun `korrektes Praefix, nur Y wird korrigiert`() {
        assertEquals(listOf("LSDD-DE121"), SetCodeOcr.extract("LSDD-DEY21"))
    }

    @Test fun `dritter Beleg derselben Familie`() {
        assertEquals(listOf("L5DD-DE119"), SetCodeOcr.extract("L5DD-DEY19"))
    }

    @Test fun `einbuchstabige Region (aeltere deutsche Drucke)`() {
        assertEquals(listOf("LOB-G005"), SetCodeOcr.extract("LOB-G005"))
        assertEquals(listOf("SDY-G005"), SetCodeOcr.extract("SDY-G005"))
        assertEquals(listOf("TSC-G003"), SetCodeOcr.extract("TSC-G003"))
    }

    @Test fun `echter Variantenbuchstabe bleibt unangetastet (Speed Duel)`() {
        // 'A' ist eine echte Variante, kein verlesenes '4' -- die Korrektur-Map ist bewusst schmal
        // (nur O->0 und Y->1), damit dieser Fall nicht verfaelscht wird.
        assertEquals(listOf("SGX3-DEA10"), SetCodeOcr.extract("SGX3-DEA10"))
    }

    @Test fun `Praefix mit eingebetteten Ziffern bleibt unveraendert`() {
        assertEquals(listOf("RA01-DE001"), SetCodeOcr.extract("RA01-DE001"))
    }

    @Test fun `deutscher Flieftext liefert keinen Set-Code`() {
        val text = "Wenn diese Karte als Spezialbeschwoerung auf das Spielfeld kommt, aktiviere diesen Effekt"
        assertTrue(SetCodeOcr.extract(text).isEmpty())
    }

    @Test fun `mehrere Codes im selben Text werden dedupliziert, erste Reihenfolge bleibt`() {
        val text = "SDSE-DEO35 irgendwas SDSE-DEO35 LOB-G005"
        assertEquals(listOf("SDSE-DE035", "LOB-G005"), SetCodeOcr.extract(text))
    }
}
