package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ui.ScanStagingLogic
import com.example.yugiohscanner.ui.theme.AppColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ScanStagingLogic] (Spec D3 Task 7) -- the pure half of the staging sheet's traffic light: the
 * "Nur unsichere" filter predicate and the dot-colour mapping. Both only MAP an already-decided
 * [ScanConfidence.Light]; they never re-derive green/yellow/red themselves (that stays
 * [ScanConfidence]'s job -- see [ScanConfidenceTest] for its own coverage).
 */
class ScanStagingLogicTest {

    // --- matchesUnsafeFilter ------------------------------------------------------------------

    @Test fun `filter off -- every light passes, including no confidence yet`() {
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(false, ScanConfidence.Light.GREEN))
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(false, ScanConfidence.Light.YELLOW))
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(false, ScanConfidence.Light.RED))
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(false, null))
    }

    @Test fun `filter on -- hides green, keeps yellow and red`() {
        assertFalse(ScanStagingLogic.matchesUnsafeFilter(true, ScanConfidence.Light.GREEN))
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(true, ScanConfidence.Light.YELLOW))
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(true, ScanConfidence.Light.RED))
    }

    @Test fun `filter on -- an entry still resolving (no confidence yet) counts as unsafe`() {
        // Nothing green to promise about it yet -- must not be hidden by "Nur unsichere".
        assertTrue(ScanStagingLogic.matchesUnsafeFilter(true, null))
    }

    // --- dotColor ------------------------------------------------------------------------------
    // "keine neuen Farben" (the brief): only the three existing theme colours, plus Muted for
    // "still resolving" -- never a fourth ampel colour. dotColor ist bewusst nicht @Composable
    // (dieser Test laeuft als reiner JVM-Test ohne Komposition) -- es vergleicht deshalb gegen
    // AppColors.light statt gegen die (jetzt @Composable) Good/Warn/ErrorColor/Muted-Rollenlesungen.

    @Test fun `dot colour -- green maps to the existing Good colour`() {
        assertEquals(AppColors.light.getValue("good"), ScanStagingLogic.dotColor(ScanConfidence.Light.GREEN))
    }

    @Test fun `dot colour -- yellow maps to the existing warn colour`() {
        assertEquals(AppColors.light.getValue("warn"), ScanStagingLogic.dotColor(ScanConfidence.Light.YELLOW))
    }

    @Test fun `dot colour -- red maps to the existing ErrorColor`() {
        assertEquals(AppColors.light.getValue("bad"), ScanStagingLogic.dotColor(ScanConfidence.Light.RED))
    }

    @Test fun `dot colour -- still resolving (no confidence yet) is Muted, not a fourth colour`() {
        assertEquals(AppColors.light.getValue("text-muted"), ScanStagingLogic.dotColor(null))
    }

    // --- firstCopyForReservation ---------------------------------------------------------------
    // Spec B2 Task 5: which of the just-created copies gets an Einsortier-Modus reservation.
    // Always the first -- see the report's decision 3 (quantity > 1: only one copy fits the slot).

    @Test fun `reservation -- single copy created gets it`() {
        assertEquals("copy-1", ScanStagingLogic.firstCopyForReservation(listOf("copy-1")))
    }

    @Test fun `reservation -- quantity greater than 1, only the first of the created copies gets it`() {
        assertEquals("copy-1", ScanStagingLogic.firstCopyForReservation(listOf("copy-1", "copy-2", "copy-3")))
    }

    @Test fun `reservation -- no copies created, nothing to reserve`() {
        assertEquals(null, ScanStagingLogic.firstCopyForReservation(emptyList()))
    }
}
