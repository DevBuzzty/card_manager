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
