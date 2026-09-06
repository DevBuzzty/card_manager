package com.example.yugiohscanner.cloud

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
 * Rules (Spec §5.3): check at app start and at most once a day (timestamp in `scanner_prefs`);
 * only download over an unmetered network unless `catalog_mobile_ok` is set; verify SHA-256 before
 * import; a checksum mismatch or unreachable storage leaves the previous catalog untouched and
 * only ever surfaces as [CatalogState.Failed] (a status line, never a popup — Spec §10).
 */
object CatalogSync {
    private const val PREFS = "scanner_prefs"
    private const val KEY_LAST_CHECK = "catalog_last_check_at"
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
        val localVersion = db.version()

        if (!force) {
            val last = prefs.getLong(KEY_LAST_CHECK, 0L)
            if (System.currentTimeMillis() - last < CHECK_INTERVAL_MS) {
                _state.value = if (localVersion > 0) CatalogState.Ready(localVersion) else CatalogState.Idle
                return
            }
        }

        _state.value = CatalogState.Checking
        // Record the attempt now, not on success: a server outage or a broken published catalog
        // must not turn into a check running (and failing) on every single app start.
        prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()

        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            _state.value = CatalogState.Failed("Kein Internetzugang")
            return
        }

        val remote = try {
            fetchLatestVersion(context)
        } catch (e: Exception) {
            _state.value = CatalogState.Failed("Server nicht erreichbar: ${e.message}")
            return
        }
        if (remote == null) {
            _state.value = CatalogState.Failed("Keine Katalogversion veroeffentlicht")
            return
        }
        if (remote.version <= localVersion) {
            _state.value = if (localVersion > 0) CatalogState.Ready(localVersion) else CatalogState.Idle
            return
        }

        val mobileOk = prefs.getBoolean(KEY_MOBILE_OK, false)
        val unmetered = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        if (!unmetered && !mobileOk) {
            // A newer catalog exists but we're not allowed to fetch it on this network yet.
            // Not an error: keep whatever catalog is already installed.
            _state.value = if (localVersion > 0) CatalogState.Ready(localVersion) else CatalogState.Idle
            return
        }

        downloadAndImport(context, db, remote)
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
                _state.value = CatalogState.Failed("Speicher nicht erreichbar: ${e.message}")
                return
            }

            if (!sha256.equals(remote.sha256, ignoreCase = true)) {
                _state.value = CatalogState.Failed("Pruefsumme stimmt nicht ueberein")
                return
            }

            val parsed = try {
                CatalogParser.parse(tempFile.readBytes())
            } catch (e: Exception) {
                _state.value = CatalogState.Failed("Katalog konnte nicht gelesen werden: ${e.message}")
                return
            }

            _state.value = CatalogState.Importing(parsed.cards.size)
            try {
                db.importAll(parsed)
            } catch (e: Exception) {
                _state.value = CatalogState.Failed("Import fehlgeschlagen: ${e.message}")
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
