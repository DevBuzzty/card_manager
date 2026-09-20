package com.example.yugiohscanner

import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.EditionEvidence.Confidence
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [EditionEvidence] pinned per Spec D3 Task 4's design (plan §7): marker matching ported from
 * `ml/label_setcodes.py`'s `FIRST_PATTERNS`/`LIMITED_PATTERNS` (see that class's doc for the
 * provenance and the four real OCR-bug fixes baked into those patterns), and the unlimited rule
 * hanging on the EDITION zone itself being legible, not the passcode line.
 */
class EditionEvidenceTest {

    // --- marker languages: first -------------------------------------------------------------

    @Test fun `1st Edition (EN)`() {
        val ev = EditionEvidence()
        ev.add("1st Edition")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    @Test fun `1 Auflage (DE)`() {
        val ev = EditionEvidence()
        ev.add("1. Auflage")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    @Test fun `1a Edicion (ES)`() {
        val ev = EditionEvidence()
        ev.add("1ª Edición")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    @Test fun `1ere Edition (FR)`() {
        val ev = EditionEvidence()
        ev.add("1ère Édition")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    @Test fun `1a Edizione (IT)`() {
        val ev = EditionEvidence()
        ev.add("1ª Edizione")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    @Test fun `1a Edicao (PT)`() {
        val ev = EditionEvidence()
        ev.add("1ª Edição")
        assertEquals(EditionEvidence.EditionResult("first", Confidence.LOW), ev.result())
    }

    // --- marker languages: limited ------------------------------------------------------------

    @Test fun `LIMITED EDITION (EN)`() {
        val ev = EditionEvidence()
        ev.add("LIMITED EDITION")
        assertEquals(EditionEvidence.EditionResult("limited", Confidence.LOW), ev.result())
    }

    @Test fun `LIMITIERTE AUFLAGE (DE)`() {
        val ev = EditionEvidence()
        ev.add("LIMITIERTE AUFLAGE")
        assertEquals(EditionEvidence.EditionResult("limited", Confidence.LOW), ev.result())
    }

    @Test fun `EDICION LIMITADA (ES)`() {
        val ev = EditionEvidence()
        ev.add("EDICIÓN LIMITADA")
        assertEquals(EditionEvidence.EditionResult("limited", Confidence.LOW), ev.result())
    }

    @Test fun `EDITION LIMITEE (FR)`() {
        val ev = EditionEvidence()
        ev.add("ÉDITION LIMITÉE")
        assertEquals(EditionEvidence.EditionResult("limited", Confidence.LOW), ev.result())
    }

    // --- limited checked before first: bare AUFLAGE-EDITION must not steal a limited card ------

    @Test fun `LIMITIERTE AUFLAGE is never mislabelled first even though it also contains AUFLAGE`() {
        val ev = EditionEvidence()
        ev.add("LIMITIERTE AUFLAGE")
        assertEquals("limited", ev.result().edition)
    }

    @Test fun `LIMITED EDITION is never mislabelled first even though it also contains EDITION`() {
        val ev = EditionEvidence()
        ev.add("LIMITED EDITION")
        assertEquals("limited", ev.result().edition)
    }

    // --- real OCR garblings from label_setcodes.py's docstring / hand-verification -------------

    @Test fun `13 Auflage -- the period misread as a second digit`() {
        val ev = EditionEvidence()
        ev.add("13 Auflage")
        assertEquals("first", ev.result().edition)
    }

    @Test fun `K Auflage -- a PSA-slab photo, leading 1st or 1 punkt collapsed entirely`() {
        val ev = EditionEvidence()
        ev.add("K Auflage")
        assertEquals("first", ev.result().edition)
    }

    @Test fun `IS Edition -- 1st collapsed, T dropped, S survives`() {
        val ev = EditionEvidence()
        ev.add("IS Edition")
        assertEquals("first", ev.result().edition)
    }

    @Test fun `AUllagE -- F misread as L`() {
        val ev = EditionEvidence()
        ev.add("1. AUllagE")
        assertEquals("first", ev.result().edition)
    }

    @Test fun `AUtlagE -- F misread as T`() {
        val ev = EditionEvidence()
        ev.add("1. AUtlagE")
        assertEquals("first", ev.result().edition)
    }

    // --- unlimited rule: hangs on the EDITION zone itself being legible ------------------------

    @Test fun `two legible (non-blank) EDITION-zone frames with no marker -- unlimited, LOW`() {
        val ev = EditionEvidence()
        ev.add("some scuff")     // legible but unrelated text
        ev.add("a dent")         // legible but unrelated text
        assertEquals(EditionEvidence.EditionResult("unlimited", Confidence.LOW), ev.result())
    }

    @Test fun `three legible (non-blank) EDITION-zone frames with no marker -- unlimited, HIGH`() {
        val ev = EditionEvidence()
        ev.add("some scuff")
        ev.add("a dent")
        ev.add("a smudge")
        assertEquals(EditionEvidence.EditionResult("unlimited", Confidence.HIGH), ev.result())
    }

    @Test fun `one legible markerless frame is NOT enough for unlimited`() {
        val ev = EditionEvidence()
        ev.add("some scuff")
        assertEquals(EditionEvidence.EditionResult("unknown", Confidence.LOW), ev.result())
    }

    // --- I1 regression: a blank OCR read is not evidence of a legible, confirmed-empty zone -----
    // (reviewer's reproduction, kept verbatim as the pinning test) ------------------------------

    @Test fun `I1 -- three BLANK frames alone must NOT fabricate unlimited HIGH`() {
        // Before the fix: add("") unconditionally incremented legibleFrames, so three frames whose
        // EDITION crop simply never yielded any text (box slightly too large, glare, a placeholder
        // rect) -- NOT a confirmed-blank zone -- produced exactly the same (unlimited, HIGH) result
        // as a genuinely read, markerless zone. Since HIGH-confidence unlimited beats a 'first'
        // default (Spec Section 7 / ScanConfidence.resolveEdition), that silently overwrote an
        // explicit user setting on nothing but an OCR failure.
        val ev = EditionEvidence()
        ev.add("")
        ev.add("")
        ev.add("")
        assertEquals(EditionEvidence.EditionResult("unknown", Confidence.LOW), ev.result())
    }

    @Test fun `I1 -- blank frames don't count towards legibility even mixed with a real read`() {
        // One genuinely legible, markerless frame plus two blanks used to read as "3 legible" (LOW
        // threshold cleared twice over). Only the one non-blank frame actually counts now -- not
        // enough on its own for unlimited.
        val ev = EditionEvidence()
        ev.add("")
        ev.add("some scuff")
        ev.add("")
        assertEquals(EditionEvidence.EditionResult("unknown", Confidence.LOW), ev.result())
    }

    @Test fun `unrelated zone text, like a leaked set code, never false-positives as a marker`() {
        val ev = EditionEvidence()
        ev.add("SDSE-DE035")
        ev.add("SDSE-DE035")
        assertEquals("unlimited", ev.result().edition)
    }

    // --- unknown: no evidence at all -------------------------------------------------------

    @Test fun `a single frame with no marker is unknown, not unlimited`() {
        val ev = EditionEvidence()
        ev.add("random ocr noise")
        assertEquals("unknown", ev.result().edition)
    }

    @Test fun `a layout with no measured EDITION zone, like PENDULUM -- add is never called -- unknown`() {
        // The caller (HybridPipeline / CardLayout) simply never calls add() when
        // CardLayout.zones(layout) has no Zone.EDITION entry -- there is no crop to read. An
        // instance nothing was ever recorded on must answer unknown, not fabricate "unlimited".
        val ev = EditionEvidence()
        assertEquals(EditionEvidence.EditionResult("unknown", Confidence.LOW), ev.result())
    }

    // --- HIGH/LOW boundaries --------------------------------------------------------------

    @Test fun `marker in exactly 1 frame is LOW`() {
        val ev = EditionEvidence()
        ev.add("1st Edition")
        assertEquals(Confidence.LOW, ev.result().confidence)
    }

    @Test fun `marker in 2 frames is HIGH`() {
        val ev = EditionEvidence()
        ev.add("1st Edition")
        ev.add("1st Edition")
        assertEquals(Confidence.HIGH, ev.result().confidence)
    }

    @Test fun `unlimited at exactly 2 legible (non-blank) frames is LOW`() {
        val ev = EditionEvidence()
        ev.add("some scuff")
        ev.add("a dent")
        assertEquals(Confidence.LOW, ev.result().confidence)
    }

    @Test fun `unlimited at 3 legible (non-blank) frames is HIGH`() {
        val ev = EditionEvidence()
        ev.add("some scuff")
        ev.add("a dent")
        ev.add("a smudge")
        assertEquals(Confidence.HIGH, ev.result().confidence)
    }

    @Test fun `a 4th agreeing marker frame stays HIGH, not a new tier`() {
        val ev = EditionEvidence()
        repeat(4) { ev.add("1st Edition") }
        assertEquals(EditionEvidence.EditionResult("first", Confidence.HIGH), ev.result())
    }

    // --- Spec Section 7: detection beats the default-edition setting ---------------------------

    @Test fun `unlimited at HIGH confidence is the signal Task 5 uses to override a 'first' default`() {
        // Spec D3 §7, verbatim: if the user's default edition (Spec A) is 'first' and detection
        // says 'unlimited' with HIGH, detection wins -- the card beats the setting. Applying that
        // override against the Spec A default is Task 5's job (the traffic light, out of scope
        // here); this test pins that EditionEvidence itself reaches exactly this result (unlimited,
        // HIGH) from 3 legible (non-blank -- see the I1 tests above for why a blank read no longer
        // counts), markerless EDITION-zone frames, which is the only signal Task 5 needs to make
        // that call.
        val ev = EditionEvidence()
        ev.add("some scuff")
        ev.add("a dent")
        ev.add("a smudge")
        assertEquals(EditionEvidence.EditionResult("unlimited", Confidence.HIGH), ev.result())
    }

    @Test fun `unlimited at LOW confidence must NOT be mistaken for the override signal`() {
        // Contrast case for the rule above: only HIGH-confidence unlimited beats a 'first' default
        // per Spec §7 -- exactly 2 legible (non-blank) frames (LOW) is a different, weaker signal.
        val ev = EditionEvidence()
        ev.add("some scuff")
        ev.add("a dent")
        assertEquals(Confidence.LOW, ev.result().confidence)
    }

    // --- Messung vom 20.09.2026 an 40 echten Zonenlesungen aus der Halterung -----------------
    // Die Lesungen unten sind WOERTLICH das, was die OCR auf den Bildern des Nutzers ausgab
    // (ml/data/scanlog/*/meldung-*.jpg, ml/data/stapel_fotos/*_halterung.jpg), nicht erfunden.

    @Test fun `die zerfallenen Lesungen echter Halterungs-Bilder gelten als erste Auflage`() {
        // "EDFDOU"/"EDHUOP": duenne Serifenschrift, i->f, t->d, i->u. Bei meldung-1789839041427
        // steht im Bild nachweislich "1st Edition" -- mit blossem Auge geprueft.
        for (lesung in listOf("It Edfdon", "EDFDOU", "EDHUOP", "1 AUFLA IVICIUCIVS", "94 1 AUSLAE INNST", "1 AUTLAS AUFLASY")) {
            val ev = EditionEvidence()
            ev.add(lesung)
            assertEquals("first bei '$lesung'", "first", ev.result().edition)
        }
    }

    @Test fun `Kartentext aus denselben Bildern loest KEINE Auflage aus`() {
        // Ebenfalls woertliche Lesungen derselben Messreihe -- die Zone liest oben den Kartentext mit.
        for (lesung in listOf("ber of Tokens des", "DESTROY", "ol Tokens destre", "TURN", "control cannot be destroyed")) {
            val ev = EditionEvidence()
            ev.add(lesung)
            assertEquals("kein Marker in '$lesung'", "unknown", ev.result().edition)
        }
    }

    @Test fun `die Wortgrenze schuetzt vor echten Kartennamen`() {
        // Ohne \b traefe AU.LA diese drei (im Katalog gefunden: 43.698 Namen und Kartentexte).
        for (lesung in listOf("Elementaraufladung", "Batterieaufladegeraet", "Traumland", "Dinonebel")) {
            val ev = EditionEvidence()
            ev.add(lesung)
            assertEquals("kein Marker in '$lesung'", "unknown", ev.result().edition)
        }
    }

    @Test fun `limitierte Auflage gewinnt weiter, auch zerfallen`() {
        // Sonst wuerde die tolerantere FIRST-Regel eine limitierte Karte als erste Auflage ausweisen.
        val ev = EditionEvidence()
        ev.add("LIMITED EDFDO")
        assertEquals("limited", ev.result().edition)
        val ev2 = EditionEvidence()
        ev2.add("LIMITIERTE AUFLA")
        assertEquals("limited", ev2.result().edition)
    }
}
