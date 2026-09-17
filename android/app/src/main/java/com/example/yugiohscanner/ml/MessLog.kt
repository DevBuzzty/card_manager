package com.example.yugiohscanner.ml

import android.util.Log
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter

/**
 * MESSUNG (vorlaeufig, Stapel-Lichtschranke): schreibt Messzeilen zusaetzlich zu logcat in
 * filesDir/stapel-mess.log, damit ohne USB gemessen werden kann. Abholen:
 * `adb shell run-as com.example.yugiohscanner cat files/stapel-mess.log`.
 */
object MessLog {
    private var writer: BufferedWriter? = null

    @Synchronized
    fun start(dir: File) {
        if (writer != null) return
        writer = try {
            BufferedWriter(FileWriter(File(dir, "stapel-mess.log"), true))
        } catch (e: Exception) {
            Log.e("StapelMess", "Messdatei nicht offen", e)
            null
        }
        line("StapelMess", "=== Scanner geoeffnet t=${System.currentTimeMillis()} ===")
    }

    @Synchronized
    fun line(tag: String, msg: String) {
        Log.i(tag, msg)
        val w = writer ?: return
        try {
            w.write("$tag $msg\n")
            w.flush()
        } catch (e: Exception) {
            Log.e("StapelMess", "Messzeile nicht geschrieben", e)
        }
    }
}

/**
 * DIAGNOSE (vorlaeufig, Stapel-Lichtschranke Performance): prueft alle 100 ms, ob der Hauptthread
 * reagiert. Haengt er laenger als 400 ms, werden die Stacks ALLER Threads einmal pro Haenger in
 * [MessLog] geschrieben -- zeigt, woran Oberflaeche und Kamera gerade blockieren.
 */
object HangWatchdog {
    @Volatile private var running = false

    fun start() {
        if (running) return
        running = true
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        Thread({
            var lastPong = System.currentTimeMillis()
            var dumped = false
            while (running) {
                main.post { lastPong = System.currentTimeMillis() }
                Thread.sleep(100)
                val stuck = System.currentTimeMillis() - lastPong
                if (stuck > 400 && !dumped) {
                    dumped = true
                    val sb = StringBuilder("haenger ${stuck} ms t=${System.currentTimeMillis()}\n")
                    for ((th, st) in Thread.getAllStackTraces()) {
                        if (st.isEmpty()) continue
                        sb.append("  THREAD ").append(th.name).append(" ").append(th.state).append('\n')
                        for (f in st.take(25)) sb.append("    at ").append(f).append('\n')
                    }
                    MessLog.line("StapelHang", sb.toString())
                } else if (stuck <= 400) {
                    dumped = false
                }
            }
        }, "HangWatchdog").apply { isDaemon = true }.start()
    }

    fun stop() { running = false }
}
