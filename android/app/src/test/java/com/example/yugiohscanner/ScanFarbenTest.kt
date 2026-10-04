package com.example.yugiohscanner

import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec 2026-10-04 Kamera-Bildschirm §6: keine fest einprogrammierten Farben auf dem Kamera-Bildschirm. */
class ScanFarbenTest {
    private val pfad = "android/app/src/main/java/com/example/yugiohscanner/ui/"
    private val verboten = listOf("Color(0x", "Color.Yellow", "Color.Red", "Color.Green", "Color.rgb(", "Color.argb(")
    // Jede benannte Farbe ausser Transparent/Unspecified/Black/White, Zahlen-Konstruktoren, parseColor und android.graphics.Color.
    private val muster = Regex("""\bColor\.(?!Transparent\b|Unspecified\b|Black\b|White\b)[A-Z][A-Za-z]*\b|\bColor\(\s*(0x|\d|red\s*=)|parseColor\(|android\.graphics\.Color\b""")

    @Test fun `auch keine anderen benannten Farben oder Farb-Konstruktoren`() {
        for (datei in listOf("ScanScreen.kt", "ScanOverlay.kt")) {
            val treffer = muster.findAll(Fixtures.text(pfad + datei)).map { it.value }.toList()
            assertTrue("$datei enthaelt $treffer", treffer.isEmpty())
        }
    }

    @Test fun `ScanScreen ohne harte Farben, auch ohne Schwarz und Weiss`() {
        val src = Fixtures.text(pfad + "ScanScreen.kt")
        for (v in verboten + listOf("Color.Black", "Color.White")) assertTrue("ScanScreen.kt enthaelt $v", v !in src)
    }

    @Test fun `ScanOverlay ohne harte Farben, Schwarz und Weiss nur in ScanFarben`() {
        val src = Fixtures.text(pfad + "ScanOverlay.kt").replace("\r\n", "\n")   // Windows-Zeilenenden
        for (v in verboten) assertTrue("ScanOverlay.kt enthaelt $v", v !in src)
        val ausserhalb = src.substringAfter("object ScanFarben").substringAfter("\n}\n")
        assertTrue("Schwarz/Weiss ausserhalb von ScanFarben", "Color.Black" !in ausserhalb && "Color.White" !in ausserhalb)
    }
}
