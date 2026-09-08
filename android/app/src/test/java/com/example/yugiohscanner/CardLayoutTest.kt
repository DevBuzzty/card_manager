package com.example.yugiohscanner

import android.graphics.RectF
import com.example.yugiohscanner.ml.CardLayout
import com.example.yugiohscanner.ml.Layout
import com.example.yugiohscanner.ml.Zone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CardLayoutTest {

    // -- layoutFor: every `type` string that actually occurs in the catalog --------------------

    @Test
    fun layoutForMapsEveryCatalogTypeString() {
        val expected = mapOf(
            "Effect Monster" to Layout.STANDARD,
            "Normal Monster" to Layout.STANDARD,
            "XYZ Monster" to Layout.STANDARD,
            "Fusion Monster" to Layout.STANDARD,
            "Synchro Monster" to Layout.STANDARD,
            "Ritual Effect Monster" to Layout.STANDARD,
            "Flip Effect Monster" to Layout.STANDARD,
            "Tuner Monster" to Layout.STANDARD,
            "Spell Card" to Layout.SPELL_TRAP,
            "Trap Card" to Layout.SPELL_TRAP,
            "Link Monster" to Layout.LINK,
            "Skill Card" to Layout.SKILL,
            // Regression guard: these carry the Pendulum frame but don't START with "Pendulum" --
            // a `startsWith` check would silently file them under STANDARD (the bug this task's
            // brief calls out explicitly).
            "XYZ Pendulum Effect Monster" to Layout.PENDULUM,
            "Synchro Pendulum Effect Monster" to Layout.PENDULUM,
        )
        for ((type, layout) in expected) {
            assertEquals("type=$type", layout, CardLayout.layoutFor(type))
        }
    }

    @Test
    fun layoutForNullTypeReturnsSaneDefaultNotCrash() {
        assertEquals(Layout.STANDARD, CardLayout.layoutFor(null))
    }

    @Test
    fun layoutForFallsBackToLegacyOnlyForUnmatchedPre2004Cards() {
        // Type match wins even for an old card.
        assertEquals(Layout.LINK, CardLayout.layoutFor("Link Monster", "1999-01-01"))
        // Unmatched type + pre-2004 date -> LEGACY safety net.
        assertEquals(Layout.LEGACY, CardLayout.layoutFor("Effect Monster", "1999-01-01"))
        // Unmatched type + modern date -> STANDARD, not LEGACY.
        assertEquals(Layout.STANDARD, CardLayout.layoutFor("Effect Monster", "2020-01-01"))
        // Unmatched type + no date -> STANDARD (no crash on missing date).
        assertEquals(Layout.STANDARD, CardLayout.layoutFor("Effect Monster", null))
    }

    // -- zones: plausibility + the STANDARD/LINK distinction that justifies this whole task -----

    @Test
    fun everyZoneLiesWithinAPlausibleCardArea() {
        for (layout in Layout.values()) {
            for ((zone, rect) in CardLayout.zones(layout)) {
                assertTrue("$layout/$zone left=${rect.left}", rect.left in -0.3f..1.3f)
                assertTrue("$layout/$zone right=${rect.right}", rect.right in -0.3f..1.3f)
                assertTrue("$layout/$zone top=${rect.top}", rect.top in -0.3f..1.4f)
                assertTrue("$layout/$zone bottom=${rect.bottom}", rect.bottom in -0.3f..1.4f)
            }
        }
    }

    @Test
    fun standardAndLinkHaveDifferentSetCodeZones() {
        val standard = CardLayout.zones(Layout.STANDARD).getValue(Zone.SET_CODE)
        val link = CardLayout.zones(Layout.LINK).getValue(Zone.SET_CODE)
        // Measured: STANDARD x 0.729..1.054 vs LINK x 0.624..0.949 -- if a future edit collapses
        // these to one shared rect, this must fail; the difference is the whole point of the task.
        assertTrue("STANDARD/LINK SET_CODE left should differ", standard.left != link.left)
        assertTrue("STANDARD/LINK SET_CODE right should differ", standard.right != link.right)
    }

    @Test
    fun unmeasuredLayoutsFallBackToStandardZones() {
        // SKILL (0 samples) and LEGACY (never measured) still have no geometry of their own --
        // they must return a usable (if provisional) zone map rather than an empty one or a crash.
        val standard = CardLayout.zones(Layout.STANDARD)
        assertZonesEqual(standard, CardLayout.zones(Layout.SKILL))
        assertZonesEqual(standard, CardLayout.zones(Layout.LEGACY))
    }

    @Test
    fun `Pendulum hat eigene, gemessene Zonen -- nicht STANDARDs Platzhalter`() {
        val p = CardLayout.zones(Layout.PENDULUM)
        val s = CardLayout.zones(Layout.STANDARD)
        // Die beiden ueberlappen NICHT -- der Platzhalter las einen voellig anderen Teil der Karte.
        assertTrue("PASSCODE muss tiefer liegen als STANDARDs",
            p.getValue(Zone.PASSCODE).top > s.getValue(Zone.PASSCODE).bottom)
        assertTrue("SET_CODE muss tiefer liegen als STANDARDs",
            p.getValue(Zone.SET_CODE).top > s.getValue(Zone.SET_CODE).bottom)
        // ... und der Set-Code sitzt LINKS, waehrend STANDARD ihn rechts hat.
        assertTrue("SET_CODE muss links sitzen", p.getValue(Zone.SET_CODE).right < 0.5f)
        assertTrue("STANDARDs SET_CODE sitzt rechts", s.getValue(Zone.SET_CODE).left > 0.5f)
        // Exakte gemessene Werte, ziffernweise gegen ml/zones_measured.json.
        assertEquals(-0.0873f, p.getValue(Zone.PASSCODE).left, 0f)
        assertEquals(0.6269f, p.getValue(Zone.PASSCODE).top, 0f)
        assertEquals(0.1746f, p.getValue(Zone.PASSCODE).right, 0f)
        assertEquals(0.815f, p.getValue(Zone.PASSCODE).bottom, 0f)
        assertEquals(-0.0202f, p.getValue(Zone.SET_CODE).left, 0f)
        assertEquals(0.5782f, p.getValue(Zone.SET_CODE).top, 0f)
        assertEquals(0.2765f, p.getValue(Zone.SET_CODE).right, 0f)
        assertEquals(0.728f, p.getValue(Zone.SET_CODE).bottom, 0f)
    }

    // -- EDITION (Spec D3 Task 0): ziffernweise gegen ml/zones_measured.json festgenagelt ---------

    @Test
    fun `EDITION-Zonen sind ziffernweise gegen zones_measured json festgenagelt`() {
        val standard = CardLayout.zones(Layout.STANDARD).getValue(Zone.EDITION)
        assertEquals(0.0957f, standard.left, 0f)
        assertEquals(0.3408f, standard.top, 0f)
        assertEquals(0.3459f, standard.right, 0f)
        assertEquals(0.575f, standard.bottom, 0f)

        val spellTrap = CardLayout.zones(Layout.SPELL_TRAP).getValue(Zone.EDITION)
        assertEquals(0.1013f, spellTrap.left, 0f)
        assertEquals(0.3264f, spellTrap.top, 0f)
        assertEquals(0.3545f, spellTrap.right, 0f)
        assertEquals(0.5562f, spellTrap.bottom, 0f)

        val link = CardLayout.zones(Layout.LINK).getValue(Zone.EDITION)
        assertEquals(0.1141f, link.left, 0f)
        assertEquals(0.3001f, link.top, 0f)
        assertEquals(0.3485f, link.right, 0f)
        assertEquals(0.5438f, link.bottom, 0f)
    }

    @Test
    fun `PENDULUM und SKILL-eigene Geometrie haben keine eigene EDITION -- unter der Messschwelle`() {
        // PENDULUM: 36 Kandidaten (28 nach Ausreisser-Filter) gegen MIN_SAMPLES=40 -- bewusst
        // unvermessen, siehe der Kommentar ueber standardZones(). pendulumZones() traegt daher
        // keinen Zone.EDITION-Eintrag.
        assertTrue(!CardLayout.zones(Layout.PENDULUM).containsKey(Zone.EDITION))
    }

    @Test
    fun `SKILL und LEGACY erben EDITION als Platzhalter, genau wie PASSCODE und SET_CODE`() {
        // Der Fallback in [CardLayout.zones] ist pro Zonen-Map, nicht pro Schluessel -- SKILL und
        // LEGACY erhalten also automatisch auch STANDARDs (provisorische) EDITION-Zone, sobald sie
        // dort existiert. Das ist beabsichtigt, nicht ein Leck: siehe unmeasuredLayoutsFallBackToStandardZones.
        assertTrue(CardLayout.zones(Layout.SKILL).containsKey(Zone.EDITION))
        assertTrue(CardLayout.zones(Layout.LEGACY).containsKey(Zone.EDITION))
    }

    // ---- Seitenverhaeltnis-Waechter (aus HybridPipeline.readZones herausgezogen) ----------------

    @Test fun `aspect teilt Breite durch Hoehe`() {
        assertEquals(1.0f, CardLayout.aspect(500f, 500f), 0.001f)
        assertEquals(1.33f, CardLayout.aspect(532f, 400f), 0.005f)
    }

    @Test fun `aspect faengt Hoehe null und negativ ab, statt zu explodieren`() {
        // Ohne coerceAtLeast(1f) gaebe eine Hoehe von 0 Infinity und eine negative ein negatives
        // Verhaeltnis -- beides wuerde den Vergleich unten stillschweigend falsch beantworten.
        assertEquals(500f, CardLayout.aspect(500f, 0f), 0.001f)
        assertEquals(500f, CardLayout.aspect(500f, -20f), 0.001f)
        assertTrue(CardLayout.aspect(500f, 0f).isFinite())
    }

    @Test fun `quadratische Artwork-Boxen werden akzeptiert`() {
        // Echte Geraetemessungen: eine korrekte Platzierung lag bei 1.015.
        for (l in listOf(Layout.STANDARD, Layout.SPELL_TRAP, Layout.LINK)) {
            assertTrue("$l 1.015", CardLayout.isArtworkShaped(l, 511f, 503f))
            assertTrue("$l genau 1.0", CardLayout.isArtworkShaped(l, 500f, 500f))
        }
        assertTrue("unbekanntes Layout", CardLayout.isArtworkShaped(null, 511f, 503f))
    }

    @Test fun `zu hohe Boxen werden verworfen`() {
        // 0.877 war auf dem Geraet der Fall, der die SET_CODE-Zone auf den Effekttext schob.
        assertTrue(!CardLayout.isArtworkShaped(Layout.STANDARD, 440f, 502f))
        assertTrue(!CardLayout.isArtworkShaped(null, 440f, 502f))
    }

    @Test fun `Pendulum-Boxen werden jetzt akzeptiert -- Band und Geometrie wanderten gemeinsam`() {
        // Eine korrekte Pendulum-Box liegt bei ~1.33 (drei unabhaengige Quellen: 11 Rig-Frames,
        // 65 Fotos, eBay-Korpus-Median). Solange zones(PENDULUM) STANDARDs Platzhalter lieferte,
        // wurde sie bewusst verworfen; seit die Zonen gemessen sind, gilt PENDULUMs eigenes Band.
        assertTrue(CardLayout.isArtworkShaped(Layout.PENDULUM, 532f, 400f))    // 1.33
        assertTrue(CardLayout.isArtworkShaped(Layout.PENDULUM, 658f, 504f))    // 1.31
        assertTrue(CardLayout.isArtworkShaped(Layout.PENDULUM, 549f, 429f))    // 1.28, Randfall
        // Eine QUADRATISCHE Box ist fuer Pendulum falsch -- dann hat der Detektor etwas anderes
        // erwischt, und PENDULUMs tief liegende Zonen wuerden ins Leere greifen.
        assertTrue(!CardLayout.isArtworkShaped(Layout.PENDULUM, 500f, 500f))
        // Und umgekehrt bleibt eine Pendulum-foermige Box fuer die quadratischen Layouts falsch.
        assertTrue(!CardLayout.isArtworkShaped(Layout.STANDARD, 532f, 400f))
        assertTrue(!CardLayout.isArtworkShaped(null, 532f, 400f))
    }

    @Test fun `Bandgrenzen sind einschliesslich`() {
        assertTrue(CardLayout.isArtworkShaped(Layout.STANDARD, 90f, 100f))    // genau 0.90
        assertTrue(CardLayout.isArtworkShaped(Layout.STANDARD, 112f, 100f))   // genau 1.12
        assertTrue(!CardLayout.isArtworkShaped(Layout.STANDARD, 89f, 100f))
        assertTrue(!CardLayout.isArtworkShaped(Layout.STANDARD, 113f, 100f))
    }

    @Test fun `Layout aus der Boxform ableiten`() {
        // Ein ~1.33 breites Artwork kann nur Pendulum sein -- kein anderes Layout hat ein so
        // breites Fenster. Die 16er-Haeufung bei 1.3 unter den Embedder-Fehltreffern im Messkorb
        // ist genau das.
        assertEquals(Layout.PENDULUM, CardLayout.inferFromBox(532f, 400f))
        assertEquals(Layout.PENDULUM, CardLayout.inferFromBox(658f, 504f))
        // Quadratisch heisst STANDARD -- stellvertretend fuer alle Layouts mit quadratischem
        // Fenster, deren Zonen sich ohnehin kaum unterscheiden.
        assertEquals(Layout.STANDARD, CardLayout.inferFromBox(511f, 503f))
        assertEquals(Layout.STANDARD, CardLayout.inferFromBox(500f, 500f))
    }

    @Test fun `Boxen ausserhalb beider Baender liefern kein Layout`() {
        // Die 55 echten Ausschussboxen aus dem Messkorb, gestreut von 0.3 bis 8.6: Kartenfetzen,
        // Bildraender, Splitter. Hier ist null die ehrliche Antwort, und der Aufrufer ueberspringt.
        for (ar in listOf(0.3f, 0.5f, 0.7f, 0.85f, 1.16f, 1.5f, 2.2f, 4.6f, 8.6f)) {
            assertEquals("ar=$ar", null, CardLayout.inferFromBox(ar * 400f, 400f))
        }
    }

    @Test fun `die beiden Baender ueberlappen nicht`() {
        // 1.12 gegen 1.20 -- eine Box faellt in hoechstens eines, es gibt nichts zu entscheiden.
        assertTrue(CardLayout.SQUARE_AR_MAX < CardLayout.PENDULUM_AR_MIN)
        assertEquals(null, CardLayout.inferFromBox(116f, 100f))   // genau dazwischen
    }

    @Test fun `abgeleitetes Layout besteht den Waechter immer`() {
        // Konstruktionsbedingt: inferFromBox liefert nur ein Layout, in dessen Band die Box liegt.
        for (ar in listOf(0.90f, 1.0f, 1.12f, 1.20f, 1.33f, 1.45f)) {
            val w = ar * 400f
            val l = CardLayout.inferFromBox(w, 400f)
            assertTrue("ar=$ar muss ein Layout liefern", l != null)
            assertTrue("ar=$ar muss den Waechter bestehen", CardLayout.isArtworkShaped(l, w, 400f))
        }
    }

    /**
     * Compares zone maps field-by-field. Not `assertEquals(Map, Map)`: that would delegate to
     * `RectF.equals`, which throws "not mocked" under this module's JVM unit-test stub jar
     * (android.graphics classes have no real implementation there).
     */
    private fun assertZonesEqual(expected: Map<Zone, RectF>, actual: Map<Zone, RectF>) {
        assertEquals(expected.keys, actual.keys)
        for (zone in expected.keys) {
            val e = expected.getValue(zone)
            val a = actual.getValue(zone)
            assertEquals("$zone left", e.left, a.left, 0.0f)
            assertEquals("$zone top", e.top, a.top, 0.0f)
            assertEquals("$zone right", e.right, a.right, 0.0f)
            assertEquals("$zone bottom", e.bottom, a.bottom, 0.0f)
        }
    }
}
