package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [SetCodeMatch] (Spec D3 Task 2) -- the structural fix for the D1 defect: `LOB-EN005` was being
 * accepted as a match for a German card because the old matcher compared the WHOLE code (region
 * included) under a length-scaled tolerance that an EN/DE swap fit inside. As of this task the
 * distance compare runs ONLY over prefix+number ([SetCodeMatch.parts]); the region is read
 * separately via [com.example.yugiohscanner.ml.RegionToken] and decides the result through the
 * plan's three binding cases (see the class doc on [SetCodeMatch.MatchResult]).
 */
class SetCodeMatchTest {

    // -- parts(): decomposition, pinned against the four codes the brief names -------------------

    @Test fun `parts zerlegt LOB-EN005`() {
        assertEquals(SetCodeMatch.CodeParts("LOB", "EN", "005"), SetCodeMatch.parts("LOB-EN005"))
    }

    @Test fun `parts zerlegt LOB-G005, einbuchstabige Region`() {
        assertEquals(SetCodeMatch.CodeParts("LOB", "G", "005"), SetCodeMatch.parts("LOB-G005"))
    }

    @Test fun `parts zerlegt SGX3-DEA10, Variantenbuchstabe gehoert zur Nummer`() {
        // Mehrstelliges Praefix (SGX3, mit eingebetteter Ziffer) UND ein Buchstabe direkt vor der
        // Nummer, der -- wie in SetCodeOcr dokumentiert -- zur NUMMER gehoert, nicht zur Region.
        assertEquals(SetCodeMatch.CodeParts("SGX3", "DE", "A10"), SetCodeMatch.parts("SGX3-DEA10"))
    }

    @Test fun `parts zerlegt RA01-DE001, mehrstelliges Praefix mit Ziffer`() {
        assertEquals(SetCodeMatch.CodeParts("RA01", "DE", "001"), SetCodeMatch.parts("RA01-DE001"))
    }

    @Test fun `parts liefert null fuer ein grammatikfremdes Muster`() {
        assertNull(SetCodeMatch.parts("nicht ein set code"))
        assertNull(SetCodeMatch.parts("LOB005")) // kein Bindestrich
    }

    // -- best(): sprachneutraler Treffer -- die Kernreparatur ------------------------------------

    @Test fun `sprachneutraler Treffer trotz fehlendem Bindestrich (Leerzeichen statt '-')`() {
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN"))
        val result = SetCodeMatch.best(listOf("LOB DE005"), known)
        // Der Treffer selbst darf nicht daran scheitern, dass die Region im Text anders lautet
        // als im bekannten Printing -- das ist genau die Verwechslung, die dieser Task ausschliesst.
        assertTrue(result.reason != SetCodeMatch.MatchReason.NO_MATCH)
    }

    @Test fun `sprachneutraler Treffer trotz OCR-Verwechslungen in Praefix und Nummer (L0B-DE0O5)`() {
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN"))
        val result = SetCodeMatch.best(listOf("L0B-DE0O5"), known)
        assertTrue(result.reason != SetCodeMatch.MatchReason.NO_MATCH)
    }

    // -- Die drei Regionsfaelle aus der verbindlichen Regel --------------------------------------

    @Test fun `Fall 1 -- Region sicher gelesen, Code wird aus Praefix+Region+Nummer zusammengesetzt`() {
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN", verified = false))
        val result = SetCodeMatch.best(listOf("LOB-DE005"), known)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, result.reason)
        assertEquals("LOB-DE005", result.selected?.setCode)
        assertEquals("DE", result.selected?.language)
    }

    @Test fun `Fall 2 -- Region nicht lesbar, nur belegte Printings werden angeboten, nichts komponiert`() {
        val known = listOf(
            SetOption("LOB-EN005", "Common", 0.0, "EN", verified = false),
            SetOption("LOB-G005", "Common", 0.0, "G", verified = true),
        )
        // Kein Bindestrich im Beleg -- RegionToken kann die Region nicht lokalisieren.
        val result = SetCodeMatch.best(listOf("LOB005"), known)
        assertEquals(SetCodeMatch.MatchReason.REGION_UNCLEAR, result.reason)
        assertEquals("Region unklar", result.reason.text)
        // Nur real existierende Printings, verifiziert zuerst -- niemals ein komponierter Code.
        assertEquals(listOf("LOB-G005", "LOB-EN005"), result.candidates.map { it.setCode })
        assertEquals("LOB-G005", result.selected?.setCode)
    }

    @Test fun `Fall 3 -- gelesene Region widerspricht einem verifizierten Druck, das verifizierte Printing gewinnt`() {
        val known = listOf(
            SetOption("SDY-G005", "Common", 0.0, "G", verified = true),
            SetOption("SDY-EN005", "Common", 0.0, "EN", verified = false),
        )
        // Der Bandtext liest (fehlerhaft) "DE", obwohl fuer dieses Praefix+Nummer ein VERIFIZIERTES
        // "G"-Printing bekannt ist -- ein Beleg schlaegt einen Lesefehler.
        val result = SetCodeMatch.best(listOf("SDY-DE005"), known)
        assertEquals(SetCodeMatch.MatchReason.REGION_CONTRADICTS_VERIFIED, result.reason)
        assertEquals("Region widerspricht bekanntem Druck", result.reason.text)
        assertEquals("SDY-G005", result.selected?.setCode)
        // Das verifizierte Printing steht vorn in der Auswahl.
        assertEquals(listOf("SDY-G005", "SDY-EN005"), result.candidates.map { it.setCode })
    }

    // -- verified schlaegt abgeleitet -------------------------------------------------------------

    @Test fun `ein echtes verifiziertes Printing wird wiederverwendet statt neu komponiert`() {
        // EN zuerst in der Liste, damit ein Bug, der blind das erste Element der Gruppe nimmt,
        // hier durchfallen wuerde: Rarity und verified muessen vom ECHTEN DE-Printing stammen.
        val known = listOf(
            SetOption("LOB-EN005", "Common", 0.0, "EN", verified = false),
            SetOption("LOB-DE005", "Ultra Rare", 0.0, "DE", verified = true),
        )
        val result = SetCodeMatch.best(listOf("LOB-DE005"), known)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, result.reason)
        assertEquals("LOB-DE005", result.selected?.setCode)
        assertEquals("Ultra Rare", result.selected?.rarity)
        assertTrue(result.selected?.verified == true)
    }

    // -- kein Treffer -----------------------------------------------------------------------------

    @Test fun `kein Treffer liefert NO_MATCH und selected=null`() {
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN"))
        // Weder Praefix noch Nummer haben irgendeine Naehe zu "QQQQQQQ..." -- kein Buchstabe
        // ueberschneidet sich mit "LOB", keine der Konfusionspaare deckt "005" gegen ein Q.
        val result = SetCodeMatch.best(listOf("QQQQQQQQQQQQQQQQQQQQQQQQ"), known)
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, result.reason)
        assertNull(result.selected)
        assertTrue(result.candidates.isEmpty())
    }

    @Test fun `leere Evidenz oder leere Printing-Liste liefert NO_MATCH`() {
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, SetCodeMatch.best(emptyList(), listOf(SetOption("LOB-EN005", "Common", 0.0))).reason)
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, SetCodeMatch.best(listOf("LOB-DE005"), emptyList()).reason)
    }

    // -- Regressionstest: der D1-Befund darf nicht wiederkehren -----------------------------------

    @Test fun `Regression -- eine deutsche Karte mit nur LOB-EN005 im Katalog bekommt NICHT die englische Printing zugewiesen`() {
        // Genau der D1-Befund: der Katalog kennt fuer diese Karte nur den englischen Code, aber der
        // Bandtext der Karte selbst liest zuverlaessig "DE". Das Ergebnis darf nicht LOB-EN005 sein
        // (das waere die englische Printing, die faelschlich fuer eine deutsche Karte akzeptiert
        // wuerde) -- unabhaengig davon, wie nah sich "EN" und "DE" unter der alten Volltext-Distanz
        // waren, denn die Region wird jetzt ueberhaupt nicht mehr mitverglichen.
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN", verified = false))
        val result = SetCodeMatch.best(listOf("LOB-DE005"), known)
        assertTrue(result.selected?.setCode != "LOB-EN005")
        assertEquals("DE", result.selected?.language)
        assertEquals("LOB-DE005", result.selected?.setCode)
    }

    // -- codeExactMatch / codeFrameCount (Spec D3 Task 6 -- the gap Task 5 found) -----------------
    //
    // ScanConfidence's green condition needs "the same code read cleanly (distance 0) in >=2
    // SEPARATE frames" -- not "distance 0 on the pooled haystack, and we happened to record >=2
    // frames total". These pin the strict, per-frame definition.

    @Test fun `codeFrameCount zaehlt jeden Frame, der EINZELN Distanz 0 erreicht`() {
        val known = listOf(SetOption("LOB-DE001", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE001", "LOB-DE001", "LOB-DE001")
        val result = SetCodeMatch.best(frames, known, frames)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, result.reason)
        assertTrue(result.codeExactMatch)
        assertEquals(3, result.codeFrameCount)
    }

    @Test fun `ein einzelner sauberer Frame reicht fuer codeExactMatch, aber nicht fuer 2 Frames`() {
        val known = listOf(SetOption("LOB-DE001", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE001")
        val result = SetCodeMatch.best(frames, known, frames)
        assertTrue(result.codeExactMatch)
        assertEquals(1, result.codeFrameCount)
    }

    @Test fun `codeFrameCount bleibt bei 1, wenn nur EIN Frame sauber war -- gepoolte Distanz 0 taeuscht sonst 2 Frames vor`() {
        // Ein sauberer Frame plus ein voellig unverwandter, verrauschter Frame. Weil best() ALLE
        // Belege zu EINEM Suchtext poolt, findet die Fenstersuche die saubere Teilzeichenkette
        // trotzdem und die gepoolte Distanz ist 0 -- genau die Falle, vor der die Aufgabe warnt
        // ("distance 0 on pooled evidence, and we happened to record 2 frames" darf NICHT gruen
        // ausloesen). codeFrameCount muss trotzdem bei 1 bleiben, weil nur EIN Frame fuer sich
        // genommen an Distanz 0 liegt.
        val known = listOf(SetOption("LOB-DE001", "Common", 0.0, "DE", verified = true))
        val frames = listOf("LOB-DE001", "QQQQQQQQQQQQQQQQQQQQQQQQ")
        val result = SetCodeMatch.best(frames, known, frames)
        assertEquals("gepoolt matcht es trotzdem (die saubere Teilzeichenkette steckt im Text)",
            SetCodeMatch.MatchReason.MATCHED, result.reason)
        assertTrue(result.codeExactMatch)
        assertEquals("aber nur EIN Frame war fuer sich genommen sauber", 1, result.codeFrameCount)
    }

    @Test fun `ein Frame mit Toleranz-Distanz (nicht 0) zaehlt nicht zu codeFrameCount`() {
        // "L0B-DE0O1" ist mit Verwechslungskosten (0.5 je Konfusionspaar) nahe an "LOB-DE001" dran
        // und wird noch akzeptiert -- aber eben NICHT an Distanz 0.
        val known = listOf(SetOption("LOB-DE001", "Common", 0.0, "DE", verified = true))
        val frames = listOf("L0B-DE0O1")
        val result = SetCodeMatch.best(frames, known, frames)
        assertEquals(SetCodeMatch.MatchReason.MATCHED, result.reason)
        assertFalse(result.codeExactMatch)
        assertEquals(0, result.codeFrameCount)
    }

    @Test fun `NO_MATCH liefert codeExactMatch=false und codeFrameCount=0`() {
        val known = listOf(SetOption("LOB-EN005", "Common", 0.0, "EN"))
        val result = SetCodeMatch.best(listOf("QQQQQQQQQQQQQQQQQQQQQQQQ"), known)
        assertEquals(SetCodeMatch.MatchReason.NO_MATCH, result.reason)
        assertFalse(result.codeExactMatch)
        assertEquals(0, result.codeFrameCount)
    }

    @Test fun `framesEvidence faellt auf evidence zurueck, wenn kein separater Parameter uebergeben wird`() {
        val known = listOf(SetOption("LOB-DE001", "Common", 0.0, "DE", verified = true))
        val result = SetCodeMatch.best(listOf("LOB-DE001"), known) // kein framesEvidence-Argument
        assertTrue(result.codeExactMatch)
        assertEquals(1, result.codeFrameCount)
    }
}
