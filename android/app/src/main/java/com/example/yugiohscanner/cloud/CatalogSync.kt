package com.example.yugiohscanner.cloud

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.example.yugiohscanner.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.security.MessageDigest

sealed interface CatalogState {
    object Idle : CatalogState
    object Checking : CatalogState
    data class Downloading(val percent: Int) : CatalogState
    data class Importing(val cards: Int) : CatalogState
    data class Ready(val version: Int) : CatalogState
    data class Failed(val reason: String) : CatalogState
}

/**
 * Keeps the local offline catalog ([CatalogDb]/[CatalogParser]) in sync with the row published in
 * Supabase's `catalog_versions` table (`kind = 'catalog'`). Reading that table and downloading the
 * catalog file both need no auth token (public RLS policy, public Storage bucket), so this works
 * before the user has signed in — it never touches [SupabaseCloud]'s session state, only its URL/
 * key resolution and shared [SupabaseCloud.http] client.
 *
 * Rules (Spec §5.3):
 * - The lightweight version lookup (`catalog_versions`) runs on **every** [checkAndUpdate] call
 *   (app start), never gated — it's a few hundred bytes and the spec asks for it at every start.
 * - The multi-MB **download** is gated to at most once a day (timestamp in `scanner_prefs`) *and*
 *   to an unmetered network unless `catalog_mobile_ok` is set — except while no catalog has ever
 *   been imported ([localVersion] == 0), where the daily gate is bypassed entirely so a fresh
 *   install keeps retrying every app start instead of being stuck for 24h. See [shouldDownloadNow].
 * - The daily-gate timestamp is only stamped for a download attempt that actually happened
 *   (success or a genuine failure once the transfer started); it is never stamped for "no
 *   network" or for a metered-network skip, since those never touched the network at all.
 * - Verify SHA-256 before import; a checksum mismatch or unreachable storage leaves the previous
 *   catalog untouched and only ever surfaces as [CatalogState.Failed] (a status line, never a
 *   popup — Spec §10), with a fixed German [CatalogState.Failed.reason] — the raw exception is
 *   logged, never shown to the user.
 */
object CatalogSync {
    private const val TAG = "CatalogSync"
    private const val PREFS = "scanner_prefs"
    private const val KEY_LAST_DOWNLOAD_AT = "catalog_last_download_at"
    private const val KEY_MOBILE_OK = "catalog_mobile_ok"
    private const val CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000

    private val _state = MutableStateFlow<CatalogState>(CatalogState.Idle)
    val state: StateFlow<CatalogState> = _state.asStateFlow()

    // A second concurrent call (e.g. a manual "check now" while the daily auto-check is still
    // running) just no-ops instead of racing it for the same temp file / DB import.
    private val mutex = Mutex()

    suspend fun checkAndUpdate(context: Context, force: Boolean = false) = withContext(Dispatchers.IO) {
        if (!mutex.tryLock()) return@withContext
        try {
            run(context.applicationContext, force)
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun run(context: Context, force: Boolean) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val db = CatalogDb(context)
        try {
            val localVersion = db.version()
            fun keepCurrent() = if (localVersion > 0) CatalogState.Ready(localVersion) else CatalogState.Idle

            // The version lookup itself is never gated — it's cheap and the spec wants it at
            // every app start. Only the download below is subject to the daily/network rules.
            _state.value = CatalogState.Checking

            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                // No network at all: not a check that ran, nothing to stamp.
                _state.value = CatalogState.Failed("Kein Internetzugang")
                return
            }

            val remote = try {
                fetchLatestVersion(context)
            } catch (e: Exception) {
                Log.w(TAG, "Versionsabfrage fehlgeschlagen", e)
                _state.value = CatalogState.Failed("Server nicht erreichbar")
                return
            }
            if (remote == null) {
                _state.value = CatalogState.Failed("Keine Katalogversion veroeffentlicht")
                return
            }
            if (remote.version <= localVersion) {
                _state.value = keepCurrent()
                return
            }

            val mobileOk = prefs.getBoolean(KEY_MOBILE_OK, false)
            val unmetered = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            val lastDownloadAt = prefs.getLong(KEY_LAST_DOWNLOAD_AT, 0L)
            if (!shouldDownloadNow(localVersion, lastDownloadAt, System.currentTimeMillis(), force, unmetered, mobileOk)) {
                // A newer catalog exists but we're not allowed/due to fetch it yet (daily gate
                // still running, or metered network without catalog_mobile_ok). Not an error and
                // not stamped, so the next app start (or the next network change) can retry.
                _state.value = keepCurrent()
                return
            }

            // From here on a real download attempt happens: stamp the gate now so this outcome
            // (success or failure) consumes today's slot, whatever it turns out to be.
            prefs.edit().putLong(KEY_LAST_DOWNLOAD_AT, System.currentTimeMillis()).apply()
            downloadAndImport(context, db, remote)
        } finally {
            db.close()
        }
    }

    /**
     * Pure decision for whether the (already-known-newer) catalog should be downloaded now.
     * Extracted because this is exactly the rule a prior version got wrong (unconditional daily
     * stamping starved fresh installs of retries) — see [CatalogSyncDecisionTest].
     */
    internal fun shouldDownloadNow(
        localVersion: Int,
        lastDownloadAtMs: Long,
        nowMs: Long,
        force: Boolean,
        isUnmetered: Boolean,
        mobileOk: Boolean,
    ): Boolean {
        // Both of these outrank the metered-network rule, by explicit product decision:
        // without a catalog the app is barely usable offline, and tapping "Jetzt prüfen" is the
        // same consent that `catalog_mobile_ok` expresses — a button that silently does nothing
        // is worse than spending 2 MB.
        if (force || localVersion == 0) return true
        if (!isUnmetered && !mobileOk) return false
        return nowMs - lastDownloadAtMs >= CHECK_INTERVAL_MS
    }

    private data class RemoteVersion(val version: Int, val url: String, val sha256: String)

    private fun fetchLatestVersion(context: Context): RemoteVersion? {
        val url = "${resolveUrl(context)}/rest/v1/catalog_versions".toHttpUrl().newBuilder()
            .addQueryParameter("kind", "eq.catalog")
            .addQueryParameter("select", "version,url,sha256")
            .build()
        val key = resolveKey(context)
        val req = Request.Builder().url(url)
            .addHeader("apikey", key)
            .addHeader("Authorization", "Bearer $key")
            .get().build()
        SupabaseCloud.http().newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}: $text")
            val arr = JSONArray(text)
            if (arr.length() == 0) return null
            val row = arr.getJSONObject(0)
            return RemoteVersion(
                version = row.getInt("version"),
                url = row.getString("url"),
                sha256 = row.getString("sha256"),
            )
        }
    }

    private suspend fun downloadAndImport(context: Context, db: CatalogDb, remote: RemoteVersion) {
        val tempFile = File.createTempFile("catalog", ".gz", context.cacheDir)
        try {
            val sha256 = try {
                _state.value = CatalogState.Downloading(0)
                download(context, remote.url, tempFile)
            } catch (e: Exception) {
                Log.w(TAG, "Download fehlgeschlagen", e)
                _state.value = CatalogState.Failed("Speicher nicht erreichbar")
                return
            }

            if (!sha256.equals(remote.sha256, ignoreCase = true)) {
                _state.value = CatalogState.Failed("Pruefsumme stimmt nicht ueberein")
                return
            }

            val parsed = try {
                CatalogParser.parse(tempFile.readBytes())
            } catch (e: Exception) {
                Log.w(TAG, "Katalog konnte nicht geparst werden", e)
                _state.value = CatalogState.Failed("Katalog konnte nicht gelesen werden")
                return
            }

            _state.value = CatalogState.Importing(parsed.cards.size)
            try {
                db.importAll(parsed)
            } catch (e: Exception) {
                Log.w(TAG, "Import fehlgeschlagen", e)
                _state.value = CatalogState.Failed("Import fehlgeschlagen")
                return
            }

            _state.value = CatalogState.Ready(parsed.version)
        } finally {
            tempFile.delete()
        }
    }

    // Streams the response body to [tempFile], reporting Downloading(percent) as bytes arrive,
    // and returns the lowercase hex SHA-256 of what was written.
    private fun download(context: Context, url: String, tempFile: File): String {
        val key = resolveKey(context)
        val req = Request.Builder().url(url).addHeader("apikey", key).get().build()
        SupabaseCloud.http().newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val body = resp.body ?: throw IOException("Leere Antwort")
            val total = body.contentLength()
            val digest = MessageDigest.getInstance("SHA-256")
            var readTotal = 0L
            body.byteStream().use { input ->
                tempFile.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        readTotal += n
                        if (total > 0) {
                            _state.value = CatalogState.Downloading(((readTotal * 100) / total).toInt().coerceIn(0, 100))
                        }
                    }
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }

    // URL/key resolution mirrors SupabaseCloud's (prefs override, else BuildConfig) but is kept
    // independent of SupabaseCloud.init()/signIn() so the catalog check never depends on, or
    // interferes with, the login flow running concurrently in AppNav.
    private fun resolveUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")
    }

    private fun resolveKey(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return (prefs.getString("supabase_key", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_KEY).trim()
    }
}
