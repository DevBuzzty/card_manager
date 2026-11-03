package com.example.yugiohscanner.cloud

import android.content.Context
import com.example.yugiohscanner.BuildConfig
import com.example.yugiohscanner.ml.ScanLog
import kotlinx.coroutines.CancellationException
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
 * Eine kaputte Datei ersetzt nie die letzte gute. Spec 2026-11-03 §3.5: jeder Lauf liefert [Lauf], Fehler stehen in
 * [letzterFehler] und im ScanLog; die Ergebnis-Seite versucht es beim Oeffnen erneut.
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

    /**
     * Schreibt bytes ueber tmp nach ziel. Rename schlaegt fehl -> ziel loeschen, nochmal; schlaegt auch das
     * fehl -> bytes direkt nach ziel schreiben. Nach Rueckkehr fehlt ziel nie: true = neue Bytes liegen dort,
     * false = Schreiben ging schief (dann nur, wenn auch vorher nichts da war oder die alte Datei erhalten blieb).
     */
    internal fun ersetzen(tmp: File, ziel: File, bytes: ByteArray): Boolean {
        return try {
            tmp.writeBytes(bytes)
            if (tmp.renameTo(ziel)) return true
            ziel.delete()
            if (tmp.renameTo(ziel)) return true
            ziel.writeBytes(bytes)
            tmp.delete()
            true
        } catch (_: Exception) {
            tmp.delete()
            false
        }
    }

    private fun url(context: Context): String {
        val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
        val base = (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")
        return "$base/storage/v1/object/public/catalog/$DATEI"
    }

    // --- Spec 2026-11-03 §3.5: Ergebnis je Lauf, sichtbarer Fehler, Retry beim Oeffnen der Ergebnis-Seite ---

    enum class Lauf { AUS_DATEI, GELADEN, NICHT_FAELLIG, BESETZT, OFFLINE, HTTP_FEHLER, KAPUTT, SCHREIBFEHLER }

    sealed interface Download {
        class Bytes(val b: ByteArray) : Download
        data class Http(val code: Int) : Download
        object Offline : Download
    }

    private val _letzterFehler = MutableStateFlow<String?>(null)
    /** Fehlertext des letzten Laufs (offline, HTTP …); null nach Erfolg oder ohne faelligen Download. */
    val letzterFehler: StateFlow<String?> = _letzterFehler

    /** Reiner Kern eines Laufs (ohne Context/SharedPreferences). Eine kaputte Datei ersetzt nie die letzte gute. */
    internal fun lauf(ausDateiGeladen: Boolean, faellig: Boolean, download: () -> Download,
                      parse: (ByteArray) -> Preise?, schreiben: (ByteArray) -> Boolean, setze: (Preise) -> Unit): Pair<Lauf, String?> {
        if (!faellig) return (if (ausDateiGeladen) Lauf.AUS_DATEI else Lauf.NICHT_FAELLIG) to null
        val bytes = when (val d = download()) {
            Download.Offline -> return Lauf.OFFLINE to "offline"
            is Download.Http -> return Lauf.HTTP_FEHLER to "HTTP ${d.code}"
            is Download.Bytes -> d.b
        }
        val neu = parse(bytes) ?: return Lauf.KAPUTT to "Datei unlesbar"
        if (!schreiben(bytes)) return Lauf.SCHREIBFEHLER to "Speichern fehlgeschlagen"
        setze(neu)
        return Lauf.GELADEN to null
    }

    /** Fehlertext nach einem Lauf: neuer Text bei Fehlern, null bei Erfolg/nicht faellig, unveraendert bei BESETZT. */
    internal fun naechsterFehler(alt: String?, lauf: Lauf, fehler: String?): String? = when (lauf) {
        Lauf.BESETZT -> alt
        Lauf.GELADEN, Lauf.AUS_DATEI, Lauf.NICHT_FAELLIG -> null
        else -> fehler
    }

    suspend fun aktualisieren(context: Context, force: Boolean = false): Lauf = withContext(Dispatchers.IO) {
        if (!lock.tryLock()) return@withContext Lauf.BESETZT
        val (lauf, fehler) = try {
            val datei = File(context.filesDir, DATEI)
            var ausDatei = false
            if (_stand.value == null && datei.exists()) {
                _stand.value = runCatching { parse(datei.readBytes()) }.getOrNull()
                ausDatei = _stand.value != null
            }
            val prefs = context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE)
            val istFaellig = force || faellig(prefs.getLong(KEY_LAST, 0L), System.currentTimeMillis(), datei.exists() && _stand.value != null)
            val ergebnis = lauf(ausDatei, istFaellig,
                download = {
                    try {
                        SupabaseCloud.http().newCall(Request.Builder().url(url(context)).build()).execute().use { r ->
                            val b = if (r.isSuccessful) r.body?.bytes() else null
                            if (b != null) Download.Bytes(b) else Download.Http(r.code)
                        }
                    } catch (_: Exception) {
                        Download.Offline   // IOException u. ae.: naechster Lauf versucht es wieder
                    }
                },
                parse = { runCatching { parse(it) }.getOrNull() },
                schreiben = { ersetzen(File(context.filesDir, "$DATEI.tmp"), datei, it) },
                setze = { _stand.value = it },
            )
            if (ergebnis.first == Lauf.GELADEN) prefs.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply()
            ergebnis
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Lauf.OFFLINE to (e.message ?: "offline")   // unerwartet (Dateisystem o. ae.): wie offline, naechster Lauf versucht es
        } finally {
            lock.unlock()
        }
        _letzterFehler.value = naechsterFehler(_letzterFehler.value, lauf, fehler)
        if (lauf != Lauf.NICHT_FAELLIG) {
            runCatching { ScanLog.line("Preise", "lauf=$lauf datum=${_stand.value?.datum ?: "-"} fehler=${fehler ?: "-"}") }
            if (fehler != null) runCatching { android.util.Log.w("CmPriceFile", "Preisdatei: $lauf $fehler") }
        }
        lauf
    }
}
