package com.example.yugiohscanner

import java.io.File

/** Liest eine Datei relativ zur Repo-Wurzel; sucht vom Arbeitsverzeichnis (android/app) aufwaerts. */
object Fixtures {
    fun text(relative: String): String {
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null) {
            val f = File(dir, relative)
            if (f.exists()) return f.readText()
            dir = dir.parentFile
        }
        error("Fixture nicht gefunden: $relative")
    }
}
