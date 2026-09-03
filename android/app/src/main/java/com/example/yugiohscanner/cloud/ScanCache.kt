package com.example.yugiohscanner.cloud

import android.content.Context
import java.io.File

/**
 * Tiny per-key disk cache for the scan path. YGOPRODeck card lookups and the 3-source set-code
 * union (fetchAllSets) are deterministic per passcode but cost a network round-trip each — the
 * set union costs several. Caching them per passcode makes re-scanning a card (and re-opening the
 * app over the same collection) instant instead of hitting the network again.
 *
 * One small JSON file per (kind,key) under filesDir/scan_cache, so concurrent writers on different
 * keys never contend. Entries expire after [TTL_MS] so a newly-released printing is eventually
 * picked up (completeness matters — see the german-setcode-sources notes). Only successful,
 * non-empty results are ever written, so a transient failure can't poison the cache.
 */
object ScanCache {
    private const val TTL_MS = 14L * 24 * 60 * 60 * 1000  // 14 days
    private var dir: File? = null

    /** Call once (e.g. Activity onCreate). Safe to call repeatedly; no-ops until initialised. */
    fun init(context: Context) {
        if (dir != null) return
        dir = File(context.applicationContext.filesDir, "scan_cache").apply { mkdirs() }
    }

    private fun file(kind: String, key: String): File? {
        val d = dir ?: return null
        val safe = key.filter { it.isLetterOrDigit() || it == '_' || it == '-' }
        if (safe.isEmpty()) return null
        return File(d, "${kind}_$safe.json")
    }

    /** Cached text for (kind,key), or null if absent, expired, or the cache isn't ready. */
    fun read(kind: String, key: String): String? {
        val f = file(kind, key) ?: return null
        if (!f.exists()) return null
        if (System.currentTimeMillis() - f.lastModified() > TTL_MS) return null
        return runCatching { f.readText() }.getOrNull()
    }

    /** Store text for (kind,key). Callers must only pass successful, non-empty results. */
    fun write(kind: String, key: String, text: String) {
        val f = file(kind, key) ?: return
        runCatching { f.writeText(text) }
    }
}
