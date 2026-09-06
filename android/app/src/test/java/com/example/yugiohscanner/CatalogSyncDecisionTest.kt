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

    @Test fun `frischer Install laedt auch ueber Mobilfunk ohne Freigabe`() {
        // Produktentscheidung: ohne Katalog ist die App offline kaum brauchbar, also schlaegt der
        // Erstinstallations-Fall die Mobilfunk-Regel. Vorher war es umgekehrt.
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 0, lastDownloadAtMs = 0L, nowMs = now,
                force = false, isUnmetered = false, mobileOk = false
            )
        )
    }

    @Test fun `frischer Install laedt auch mit Mobilfunk-Freigabe`() {
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 0, lastDownloadAtMs = 0L, nowMs = now,
                force = false, isUnmetered = false, mobileOk = true
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

    @Test fun `Mobilfunk-Freigabe hebelt das Tagesfenster nicht aus`() {
        // Trennt "Freigabe erlaubt mobiles Laden" von "ein Tag ist vergangen": hier ist nur die
        // Freigabe gesetzt, das Fenster laeuft noch.
        assertFalse(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now, nowMs = now,
                force = false, isUnmetered = false, mobileOk = true
            )
        )
    }

    @Test fun `force ignoriert Tagesfenster und Netzregel`() {
        // Produktentscheidung: ein ausdruecklicher Tipp auf "Jetzt pruefen" ist dieselbe
        // Einwilligung wie catalog_mobile_ok. Ein Knopf, der stumm nichts tut, waere schlechter.
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now, nowMs = now,
                force = true, isUnmetered = true, mobileOk = false
            )
        )
        assertTrue(
            CatalogSync.shouldDownloadNow(
                localVersion = 5, lastDownloadAtMs = now, nowMs = now,
                force = true, isUnmetered = false, mobileOk = false
            )
        )
    }
}
