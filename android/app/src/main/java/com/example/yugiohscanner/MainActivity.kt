package com.example.yugiohscanner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.example.yugiohscanner.ui.AppNav
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
        setContent { AppTheme { AppNav() } }
    }
}
