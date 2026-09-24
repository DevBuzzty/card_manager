package com.example.yugiohscanner

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.example.yugiohscanner.ui.AppNav
import com.example.yugiohscanner.ui.DeckImportInbox
import com.example.yugiohscanner.ui.theme.AppTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Per-passcode disk cache for card lookups + the set-code union, so re-scanning is instant.
        com.example.yugiohscanner.cloud.ScanCache.init(this)
        // Offline catalog (Task 9: catalog-first reads in scan/search/detail) — must be
        // initialized before those screens can read it. Cheap: opens the SQLiteOpenHelper only,
        // no disk I/O yet.
        com.example.yugiohscanner.cloud.CatalogRepository.init(this)
        // Kaltstart-Zwischenspeicher: gespeicherter Sammlungsstand, sofort sichtbar nach der Anmeldung.
        com.example.yugiohscanner.cloud.CollectionStore.useDeviceCache(
            com.example.yugiohscanner.cloud.FileSnapshotStore(java.io.File(filesDir, "sammlung.bin")),
        )
        // Spec E2 §6: an die App geteilter Text -> Import-Vorschau (nicht erneut nach einer Wiederherstellung).
        if (savedInstanceState == null) offerSharedText(intent)
        setContent {
            // Spec I §6.4 -- gespeicherter Wert als Zustand, damit ein Wechsel in den Einstellungen sofort wirkt.
            var theme by remember { mutableStateOf(Prefs.theme(this)) }
            AppTheme(setting = theme) { AppNav(onThemeChange = { theme = it }) }
        }
    }

    // singleTask (Manifest): ein weiteres Teilen erreicht die laufende App hier.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        offerSharedText(intent)
    }

    private fun offerSharedText(intent: Intent?) {
        // F3: ein Neuaufruf aus "Zuletzt verwendet" traegt dasselbe Intent-Extra weiter -- ohne diese Sperre
        // spielte jeder Blick in die Uebersicht den zuletzt geteilten Text erneut ab.
        val launchedFromHistory = (intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
        DeckImportInbox.sharedText(intent?.action, intent?.type, intent?.getCharSequenceExtra(Intent.EXTRA_TEXT), launchedFromHistory)
            ?.let { DeckImportInbox.offer(it) }
    }
}
