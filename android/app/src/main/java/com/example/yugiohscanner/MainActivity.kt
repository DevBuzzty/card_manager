package com.example.yugiohscanner

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
        // Spec E2 §6: an die App geteilter Text -> Import-Vorschau (nicht erneut nach einer Wiederherstellung).
        if (savedInstanceState == null) offerSharedText(intent)
        setContent { AppTheme { AppNav() } }
    }

    // singleTask (Manifest): ein weiteres Teilen erreicht die laufende App hier.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        offerSharedText(intent)
    }

    private fun offerSharedText(intent: Intent?) {
        DeckImportInbox.sharedText(intent?.action, intent?.type, intent?.getCharSequenceExtra(Intent.EXTRA_TEXT))
            ?.let { DeckImportInbox.offer(it) }
    }
}
