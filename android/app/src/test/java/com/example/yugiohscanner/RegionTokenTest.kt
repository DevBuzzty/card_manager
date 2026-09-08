package com.example.yugiohscanner

import com.example.yugiohscanner.ml.RegionToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [RegionToken.read] (Spec D3 Task 1): reads a set code's region infix from the card's own OCR
 * text, independently of the catalog. This is the fix for the D1 defect where `LOB-EN005` was
 * accepted as a match for `LOB-DE005` -- fuzzy-matching the WHOLE code costs only 2 of 8 chars
 * for that swap, well inside the matcher's tolerance. Splitting prefix/region/number and reading
 * the region on its own only closes that hole if a wrong or uncertain read comes back `null`
 * instead of a guess, so every ambiguous case below is pinned to `null`, not to a "best" answer.
 *
 * `prefix`/`number` in these tests are the already-established, clean values -- exactly what
 * [com.example.yugiohscanner.ml.SetCodeOcr.extract] would produce for the same raw string (see
 * [SetCodeOcrTest], which pins e.g. `SetCodeOcr.extract("L5DD-DEY25") == "L5DD-DE125"`, i.e.
 * prefix "L5DD" untouched, number "125" with the Y->1 variant correction folded in). `zoneText`
 * is the raw, noisy OCR reading RegionToken has to search for the region hiding between them.
 */
class RegionTokenTest {

    @Test fun `sauberer Code, zweibuchstabige Region`() {
        assertEquals("DE", RegionToken.read("LOB-DE005", "LOB", "005"))
    }

    @Test fun `sauberer Code, einbuchstabige Region (aeltere deutsche Drucke)`() {
        assertEquals("G", RegionToken.read("LOB-G005", "LOB", "005"))
        assertEquals("G", RegionToken.read("SDY-G005", "SDY", "005"))
        assertEquals("G", RegionToken.read("TSC-G003", "TSC", "003"))
    }

    @Test fun `typische OCR-Fehler in Praefix und Nummer werden toleriert`() {
        // "L0B" statt "LOB" (0 fuer O), "0O5" statt "005" (O fuer 0) -- beides ueber dieselbe
        // Confusion-Tabelle, die auch SetCodeMatch verwendet.
        assertEquals("DE", RegionToken.read("L0B-DE0O5", "LOB", "005"))
    }

    @Test fun `kein Bindestrich, kein Code -- null statt Rateversuch`() {
        assertNull(RegionToken.read("LOB005", "LOB", "005"))
    }

    @Test fun `unbekanntes Kuerzel -- null statt Rateversuch`() {
        assertNull(RegionToken.read("LOB-XX005", "LOB", "005"))
    }

    @Test fun `zwei plausible Regionen im selben Zonentext -- mehrdeutig, also null`() {
        // Steht fuer gepoolten Text aus mehreren Frames, die sich widersprechen: ein Frame las
        // "DE005", ein anderer "EN005". Beides ist fuer sich genommen ein gueltiger Treffer --
        // genau deshalb darf keiner davon automatisch gewinnen.
        assertNull(RegionToken.read("LOB-DE005 LOB-EN005", "LOB", "005"))
    }

    // -- Echte Geraete-/Corpus-Ablesungen (siehe task-1-brief.md) --------------------------------

    @Test fun `SDSE-DE024, sauber`() {
        assertEquals("DE", RegionToken.read("SDSE-DE024", "SDSE", "024"))
    }

    @Test fun `SDSE-DEO35, O vor der Nummer`() {
        assertEquals("DE", RegionToken.read("SDSE-DEO35", "SDSE", "035"))
    }

    @Test fun `L5DD-DEY25, Y vor der Nummer und verlesenes Praefix`() {
        assertEquals("DE", RegionToken.read("L5DD-DEY25", "L5DD", "125"))
    }

    @Test fun `I5DD-DEY25, dieselbe Karte mit I statt L im Praefix`() {
        assertEquals("DE", RegionToken.read("I5DD-DEY25", "I5DD", "125"))
    }

    @Test fun `1SDD-DEY21, Ziffer 1 statt L im Praefix`() {
        assertEquals("DE", RegionToken.read("1SDD-DEY21", "1SDD", "121"))
    }

    @Test fun `DIFO-DEO21, O vor der Nummer`() {
        assertEquals("DE", RegionToken.read("DIFO-DEO21", "DIFO", "021"))
    }

    @Test fun `region E-F Verwechslung wird aufgeloest (gepinnte Entscheidung)`() {
        // DIFO-DFO19 ist DIFO-DE019 mit verlesenem 'E' als 'F'. Siehe die Entscheidung im
        // Klassenkommentar von RegionToken.classify: ein einzelner E-F-Tausch wird akzeptiert,
        // weil er eng genug ist, um keine neue Mehrdeutigkeit zu erzeugen, und weil er eine
        // echte, im Projekt-Corpus belegte Ablesung rettet.
        assertEquals("DE", RegionToken.read("DIFO-DFO19", "DIFO", "019"))
    }

    @Test fun `LEDE-DEOO9, doppeltes O vor der Nummer`() {
        assertEquals("DE", RegionToken.read("LEDE-DEOO9", "LEDE", "009"))
    }

    @Test fun `SGX3-DEA10, echter Variantenbuchstabe bleibt unangetastet`() {
        // 'A' ist keine verlesene Ziffer -- SetCodeOcr.extract laesst sie unangetastet, die
        // erwartete Nummer ist also "A10", nicht "410" oder Aehnliches.
        assertEquals("DE", RegionToken.read("SGX3-DEA10", "SGX3", "A10"))
    }

    @Test fun `CT14-DEOO2, doppeltes O vor der Nummer`() {
        assertEquals("DE", RegionToken.read("CT14-DEOO2", "CT14", "002"))
    }

    // -- Negativkontrollen: normaler Kartentext darf nie einen Code erfinden --------------------

    @Test fun `Kartentext liefert keine Region`() {
        for (text in listOf(
            "Rank-Up-Magic Argent Chaos Force",
            "Ein Effekt-Monster mit ATK-2400",
            "SPYRAL GEAR - Last Resort",
            "Wenn diese Karte als Spezialbeschwoerung auf das Spielfeld kommt, aktiviere diesen Effekt",
        )) {
            assertNull("faelschlich eine Region erkannt in: $text", RegionToken.read(text, "LOB", "005"))
        }
    }
}
