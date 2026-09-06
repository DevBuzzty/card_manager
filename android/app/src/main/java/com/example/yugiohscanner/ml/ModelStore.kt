package com.example.yugiohscanner.ml

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.example.yugiohscanner.BuildConfig
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * Delivers the three scanner model files (`index.bin`, `embedder.onnx`, `detector.onnx`) the same
 * way [CatalogSync] delivers the offline catalog: a `catalog_versions` row per `kind`
 * (`index`/`embedder`/`detector`) on the same public bucket, no auth token needed. [bytes] is the
 * only lookup [DetectorModel]/[EmbedderModel]/[IndexSearcher] use — it prefers a file already
 * downloaded to `filesDir/models/`, falling back to the APK asset that shipped with the app
 * (the normal case until a model has ever been uploaded).
 *
 * Reuses [CatalogSync.shouldDownloadNow] for the identical daily/metered-network gate, and mirrors
 * its checksum-before-swap and German-log shapes, without modifying that file.
 */
object ModelStore {
    private const val TAG = "ModelStore"
    private const val PREFS = "scanner_prefs"
    private const val KEY_MOBILE_OK = "catalog_mobile_ok"

    private val mutex = Mutex()

    private data class Kind(val kind: String, val fileName: String)

    private val KINDS = listOf(
        Kind("index", "index.bin"),
        Kind("embedder", "embedder.onnx"),
        Kind("detector", "detector.onnx"),
    )

    /** Reads `filesDir/models/<name>` when it exists, else falls back to the APK asset. */
    fun bytes(context: Context, name: String): ByteArray {
        val local = File(File(context.filesDir, "models"), name)
        return if (local.exists() && local.length() > 0) local.readBytes() else context.assets.open(name).readBytes()
    }

    suspend fun checkAndUpdate(context: Context) = withContext(Dispatchers.IO) {
        if (!mutex.tryLock()) return@withContext
        try {
            val appContext = context.applicationContext
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return@withContext

            val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val mobileOk = prefs.getBoolean(KEY_MOBILE_OK, false)
            val unmetered = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

            for (kind in KINDS) {
                updateOne(appContext, prefs, kind, unmetered, mobileOk)
            }
        } finally {
            mutex.unlock()
        }
    }

    private data class RemoteModel(val version: Int, val url: String, val sha256: String)

    private fun updateOne(context: Context, prefs: SharedPreferences, kind: Kind, unmetered: Boolean, mobileOk: Boolean) {
        val versionKey = "model_version_${kind.kind}"
        val lastDownloadKey = "model_last_download_at_${kind.kind}"
        val localVersion = prefs.getInt(versionKey, 0)

        val remote = try {
            fetchLatestVersion(context, kind.kind)
        } catch (e: Exception) {
            Log.w(TAG, "Versionsabfrage fuer ${kind.kind} fehlgeschlagen", e)
            return
        } ?: return
        if (remote.version <= localVersion) return

        val lastDownloadAt = prefs.getLong(lastDownloadKey, 0L)
        // Reuse the catalog's download gate (daily + metered-network check) for models too.
        // The three models together (~22 MB: detector.onnx 10.6, index.bin 7.5, embedder.onnx 4.0)
        // are treated the same as the 2.1 MB catalog — the cost is accepted.
        val shouldDownload = CatalogSync.shouldDownloadNow(
            localVersion, lastDownloadAt, System.currentTimeMillis(), false, unmetered, mobileOk
        )
        if (!shouldDownload) return

        prefs.edit().putLong(lastDownloadKey, System.currentTimeMillis()).apply()

        val modelsDir = File(context.filesDir, "models")
        modelsDir.mkdirs()
        val tempFile = File(modelsDir, "${kind.fileName}.tmp")
        try {
            val sha256 = try {
                download(context, remote.url, tempFile)
            } catch (e: Exception) {
                Log.w(TAG, "Download fuer ${kind.kind} fehlgeschlagen", e)
                return
            }
            if (!sha256.equals(remote.sha256, ignoreCase = true)) {
                Log.w(TAG, "Pruefsumme fuer ${kind.kind} stimmt nicht ueberein")
                return
            }
            val localFile = File(modelsDir, kind.fileName)
            if (!tempFile.renameTo(localFile)) {
                Log.w(TAG, "Modelldatei ${kind.fileName} konnte nicht ersetzt werden")
                return
            }
            prefs.edit().putInt(versionKey, remote.version).apply()
        } finally {
            tempFile.delete()
        }
    }

    private fun fetchLatestVersion(context: Context, kind: String): RemoteModel? {
        val url = "${resolveUrl(context)}/rest/v1/catalog_versions".toHttpUrl().newBuilder()
            .addQueryParameter("kind", "eq.$kind")
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
            return RemoteModel(
                version = row.getInt("version"),
                url = row.getString("url"),
                sha256 = row.getString("sha256"),
            )
        }
    }

    // Streams the response body to [tempFile] and returns the lowercase hex SHA-256 of what was
    // written, same shape as CatalogSync.download but without the percent-progress state (no UI
    // consumer for model downloads).
    private fun download(context: Context, url: String, tempFile: File): String {
        val key = resolveKey(context)
        val req = Request.Builder().url(url).addHeader("apikey", key).get().build()
        SupabaseCloud.http().newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("HTTP ${resp.code}")
            val body = resp.body ?: throw IOException("Leere Antwort")
            val digest = MessageDigest.getInstance("SHA-256")
            body.byteStream().use { input ->
                tempFile.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                    }
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }

    // URL/key resolution duplicated from CatalogSync (prefs override, else BuildConfig) since
    // that function is private there — kept independent on purpose, same as CatalogSync is kept
    // independent of SupabaseCloud's session state.
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
