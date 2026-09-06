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
        // PENDULUM and SKILL have no measured geometry (23 and 0 usable samples, below the
        // 40-sample minimum) -- they must still return a usable (if provisional) zone map rather
        // than an empty one or a crash.
        val standard = CardLayout.zones(Layout.STANDARD)
        assertZonesEqual(standard, CardLayout.zones(Layout.PENDULUM))
        assertZonesEqual(standard, CardLayout.zones(Layout.SKILL))
        assertZonesEqual(standard, CardLayout.zones(Layout.LEGACY))
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
