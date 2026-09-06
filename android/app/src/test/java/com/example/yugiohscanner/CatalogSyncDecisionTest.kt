package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogSync
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [CatalogSync.shouldDownloadNow] is the pure decision that Fix round 1 extracted after review
 * found the original code starving a fresh install of retries (daily gate stamped unconditionally,
 * before connectivity/metered checks even ran). These cases pin the corrected rule down.
 */
class CatalogSyncDecisionTest {

    private val day = 24L * 60 * 60 * 1000
    private val now = 10 * day

    @Test fun `frischer Install laedt sofort, auch wenn ein Versuch heute schon gestempelt waere`() {
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 0, lastDownloadAtMs = now, nowMs = now,
                force = false, isUnmetered = true, mobileOk = false
            )
        )
    }

    @Test fun `frischer Install auf mobilem Netz ohne Freigabe wartet trotzdem auf WLAN`() {
        assertFalse(
            CatalogSync.shouldDownloadNow(
                localVersion = 0, lastDownloadAtMs = 0L, nowMs = now,
                force = false, isUnmetered = false, mobileOk = false
            )
        )
    }

    @Test fun `bestehender Katalog wartet das Tagesfenster ab`() {
        assertFalse(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now - (day / 2), nowMs = now,
                force = false, isUnmetered = true, mobileOk = false
            )
        )
    }

    @Test fun `bestehender Katalog laedt erneut, sobald ein Tag vergangen ist`() {
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now - day, nowMs = now,
                force = false, isUnmetered = true, mobileOk = false
            )
        )
    }

    @Test fun `mobiles Netz mit Freigabe zaehlt wie WLAN`() {
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now - day, nowMs = now,
                force = false, isUnmetered = false, mobileOk = true
            )
        )
    }

    @Test fun `force ignoriert das Tagesfenster, aber nicht die Netzregel`() {
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now, nowMs = now,
                force = true, isUnmetered = true, mobileOk = false
            )
        )
        assertFalse(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now, nowMs = now,
                force = true, isUnmetered = false, mobileOk = false
            )
        )
    }
}
