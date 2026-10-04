package com.example.yugiohscanner.cloud

import android.content.Context
import com.example.yugiohscanner.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.zip.GZIPInputStream

/**
 * Spec 2026-10-04 §3.3 -- Cardmarket-Tagespreise je Produkt (idProduct -> Trend/Tief) fuer die
 * Ergebnis-Seite. Die Cloud-Funktion refresh-cardmarket-prices legt die Datei taeglich um 05:00 UTC
 * in den oeffentlichen Bucket `catalog`. Geladen wird hoechstens 1x/Tag, danach offline aus filesDir.
 * Eine kaputte Datei ersetzt nie die letzte gute.
 */
object CmPriceFile {
    data class Preise(val datum: String, val trend: Map<Int, Double>, val low: Map<Int, Double>)

    private const val DATEI = "cm-prices.json.gz"
    private const val KEY_LAST = "cm_prices_last_download_at"
    private const val INTERVAL_MS = 24L * 60 * 60 * 1000
    private val lock = Mutex()
    private val _stand = MutableStateFlow<Preise?>(null)
    val stand: StateFlow<Preise?> = _stand

    fun aktuell(): Preise? = _stand.value

    fun parse(gz: ByteArray): Preise {
        val text = GZIPInputStream(gz.inputStream()).bufferedReader().use { it.readText() }
        val o = JSONObject(text)
        val p = o.getJSONObject("p")
        val trend = HashMap<Int, Double>(p.length() * 2)
        val low = HashMap<Int, Double>(p.length() * 2)
        for (k: String in p.keys().asSequence().map { it as String }) {
            val id = k.toIntOrNull() ?: continue
            val a = p.getJSONArray(k)
            if (!a.isNull(0)) trend[id] = a.getDouble(0)
            if (a.length() > 1 && !a.isNull(1)) low[id] = a.getDouble(1)
        }
        return Preise(o.getString("date"), trend, low)
    }

    internal fun faellig(lastMs: Long, nowMs: Long, dateiDa: Boolean): Boolean =
        !dateiDa || nowMs - lastMs >= INTERVAL_MS

    private fun url(context: Context): String {
        val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
        val base = (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")
        return "$base/storage/v1/object/public/catalog/$DATEI"
    }

    suspend fun aktualisieren(context: Context, force: Boolean = false) = withContext(Dispatchers.IO) {
        if (!lock.tryLock()) return@withContext
        try {
            val datei = File(context.filesDir, DATEI)
            if (_stand.value == null && datei.exists()) {
                _stand.value = runCatching { parse(datei.readBytes()) }.getOrNull()
            }
            val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
            if (!force && !faellig(prefs.getLong(KEY_LAST, 0L), System.currentTimeMillis(), datei.exists())) return@withContext
            val bytes = SupabaseCloud.http().newCall(Request.Builder().url(url(context)).build()).execute().use { r ->
                if (!r.isSuccessful) return@withContext
                r.body?.bytes() ?: return@withContext
            }
            val neu = runCatching { parse(bytes) }.getOrNull() ?: return@withContext   // kaputt: alte behalten
            val tmp = File(context.filesDir, "$DATEI.tmp")
            tmp.writeBytes(bytes)
            // Umbenennen robust: schlaegt es fehl, Ziel loeschen und einmal wiederholen;
            // klappt auch das nicht, bleibt die alte Datei und KEY_LAST ungesetzt (naechster Start versucht es erneut).
            if (!tmp.renameTo(datei)) {
                datei.delete()
                if (!tmp.renameTo(datei)) {
                    tmp.delete()
                    return@withContext
                }
            }
            prefs.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply()
            _stand.value = neu
        } catch (_: Exception) {
            // offline o. ae.: naechster Start versucht es wieder
        } finally {
            lock.unlock()
        }
    }
}
