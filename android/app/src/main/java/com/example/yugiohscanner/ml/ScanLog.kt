package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.FileWriter

/**
 * Scan-Protokoll (19.09.2026): jede Scanner-Sitzung schreibt ihre Ereignisse in
 * files/scanlog/sitzung-<zeit>.log -- Einwuerfe (auch verworfene), Bestaetigungen, Buchungen, Sendungen,
 * Set-Code-Entscheidungen, Bildluecken der Kamera, Haenger der Oberflaeche -- und legt zu Einwuerfen,
 * die nicht gebucht werden, ein Foto ab. Nur Ereignisse, keine Zeile pro Bild. Damit laesst sich ein
 * echter Lauf ohne Kabel auswerten; abholen mit
 * `adb exec-out run-as com.example.yugiohscanner tar -cf - -C files scanlog`.
 * Es werden hoechstens [MAX_SESSIONS] Sitzungen und je Sitzung [MAX_PHOTOS] Fotos behalten.
 */
object ScanLog {
    private const val MAX_SESSIONS = 10
    private const val MAX_PHOTOS = 40
    private const val HANG_MS = 500L

    private var writer: BufferedWriter? = null
    private var photoDir: File? = null
    private var photos = 0
    // Jede Sitzung ihr eigener Waechter: ein alter Thread beendet sich, sobald die Generation wechselt.
    @Volatile private var watchdogGen = 0

    @Synchronized
    fun start(filesDir: File, mode: String) {
        stop()
        val dir = File(filesDir, "scanlog").apply { mkdirs() }
        // Aelteste Sitzungen (Datei + Fotoordner) raeumen.
        val sessions = dir.listFiles { f -> f.name.startsWith("sitzung-") && f.name.endsWith(".log") }
            ?.sortedBy { it.name } ?: emptyList()
        for (old in sessions.dropLast(MAX_SESSIONS - 1)) {
            old.delete()
            File(dir, old.name.removeSuffix(".log")).deleteRecursively()
        }
        val name = "sitzung-${System.currentTimeMillis()}"
        photoDir = File(dir, name)
        photos = 0
        writer = try { BufferedWriter(FileWriter(File(dir, "$name.log"))) } catch (e: Exception) { null }
        line("Sitzung", "start modus=$mode")
        startWatchdog()
    }

    @Synchronized
    fun line(tag: String, msg: String) {
        Log.i(tag, msg)
        val w = writer ?: return
        try {
            w.write("${System.currentTimeMillis()} $tag $msg\n")
            w.flush()
        } catch (e: Exception) {
            Log.e("ScanLog", "Zeile nicht geschrieben", e)
        }
    }

    /** Foto ablegen (Name ohne Endung); liefert den Dateinamen oder null (Grenze erreicht / Fehler). */
    fun photo(frame: Bitmap, name: String): String? {
        val dir = synchronized(this) {
            if (writer == null || photos >= MAX_PHOTOS) return null
            photos++
            photoDir
        } ?: return null
        return try {
            dir.mkdirs()
            val f = File(dir, "$name.jpg")
            FileOutputStream(f).use { frame.compress(Bitmap.CompressFormat.JPEG, 85, it) }
            f.name
        } catch (e: Exception) {
            null
        }
    }

    @Synchronized
    fun stop() {
        watchdogGen++
        writer?.let { runCatching { it.write("${System.currentTimeMillis()} Sitzung ende\n"); it.close() } }
        writer = null
    }

    /** Haengt der Hauptthread laenger als [HANG_MS], eine Zeile mit Dauer und den obersten Aufrufen. */
    private fun startWatchdog() {
        val gen = ++watchdogGen
        val main = Handler(Looper.getMainLooper())
        Thread({
            var lastPong = System.currentTimeMillis()
            var hangStack: String? = null
            var hangMax = 0L
            while (watchdogGen == gen) {
                main.post { lastPong = System.currentTimeMillis() }
                try { Thread.sleep(100) } catch (e: InterruptedException) { return@Thread }
                val stuck = System.currentTimeMillis() - lastPong
                if (stuck > HANG_MS) {
                    // Stapel beim ersten Ueberschreiten merken -- da haengt er gerade.
                    if (hangStack == null) hangStack = Looper.getMainLooper().thread.stackTrace.take(6).joinToString(" < ")
                    hangMax = maxOf(hangMax, stuck)
                } else if (hangStack != null) {
                    line("Haenger", "${hangMax}ms $hangStack")
                    hangStack = null
                    hangMax = 0L
                }
            }
        }, "ScanLogWatchdog").apply { isDaemon = true }.start()
    }
}
