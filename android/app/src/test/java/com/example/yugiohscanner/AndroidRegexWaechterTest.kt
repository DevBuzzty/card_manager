package com.example.yugiohscanner

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Wacht ueber eine Falle, die kein anderer Unit-Test sehen kann (Absturz am 21.09.2026).
 *
 * Diese Tests laufen auf der JVM, die App auf Androids ICU-Regex. Die JVM versteht das
 * Kennzeichen (?U) (UNICODE_CHARACTER_CLASS), ICU nicht: `Regex("(?U)...")` wirft auf dem Geraet
 * beim ersten Zugriff eine PatternSyntaxException -- in Duplicates.kt beim App-Start. Alle 644
 * Tests waren gruen, die App stuerzte trotzdem ab. Fuer "Unicode-Leerzeichen" gibt es [\s\p{Z}],
 * das auf beiden Plattformen gleich wirkt.
 */
class AndroidRegexWaechterTest {

    @Test
    fun `kein Regex-Kennzeichen, das Android nicht kennt`() {
        val quellen = File("src/main/java")
        assertTrue("Quellordner nicht gefunden: ${quellen.absolutePath}", quellen.isDirectory)
        val verboten = listOf("(?U)")
        val treffer = quellen.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { f ->
                f.readLines().mapIndexedNotNull { i, zeile ->
                    val code = zeile.substringBefore("//")
                    if (verboten.any { it in code }) "${f.name}:${i + 1}: ${zeile.trim()}" else null
                }
            }
            .toList()
        assertTrue("Android-fremde Regex-Kennzeichen:\n" + treffer.joinToString("\n"), treffer.isEmpty())
    }
}
