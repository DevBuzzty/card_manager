package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CmPriceFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class CmPriceFileTest {
    private fun gz(s: String): ByteArray = ByteArrayOutputStream().also { b -> GZIPOutputStream(b).use { it.write(s.toByteArray()) } }.toByteArray()

    @Test
    fun `parse liest Datum, Trend und Tief, null bleibt leer`() {
        val p = CmPriceFile.parse(gz("""{"v":1,"date":"2026-10-04","p":{"101":[1.5,0.2],"102":[null,0.5]}}"""))
        assertEquals("2026-10-04", p.datum)
        assertEquals(1.5, p.trend[101]!!, 0.0)
        assertEquals(null, p.trend[102])
        assertEquals(0.5, p.low[102]!!, 0.0)
    }

    @Test(expected = Exception::class)
    fun `parse einer abgeschnittenen Datei wirft -- alte Preise bleiben beim Aufrufer`() {
        val voll = gz("""{"v":1,"date":"2026-10-04","p":{"101":[1.5,0.2]}}""")
        CmPriceFile.parse(voll.copyOf(voll.size / 2))
    }

    @Test
    fun `ersetzen legt Ziel neu an und raeumt tmp weg`() {
        val dir = java.nio.file.Files.createTempDirectory("cm").toFile()
        val ziel = java.io.File(dir, "z.gz"); val tmp = java.io.File(dir, "z.gz.tmp")
        assertTrue(CmPriceFile.ersetzen(tmp, ziel, byteArrayOf(1, 2)))
        assertEquals(listOf<Byte>(1, 2), ziel.readBytes().toList())
        assertEquals(false, tmp.exists())
    }

    @Test
    fun `ersetzen ersetzt vorhandenes Ziel`() {
        val dir = java.nio.file.Files.createTempDirectory("cm").toFile()
        val ziel = java.io.File(dir, "z.gz"); val tmp = java.io.File(dir, "z.gz.tmp")
        ziel.writeBytes(byteArrayOf(9))
        assertTrue(CmPriceFile.ersetzen(tmp, ziel, byteArrayOf(3, 4)))
        assertEquals(listOf<Byte>(3, 4), ziel.readBytes().toList())
    }

    @Test
    fun `ersetzen laesst Ziel bei Fehler nicht verschwinden`() {
        val dir = java.nio.file.Files.createTempDirectory("cm").toFile()
        val ziel = java.io.File(dir, "z.gz"); val tmp = java.io.File(dir, "z.gz.tmp")
        ziel.writeBytes(byteArrayOf(9))
        tmp.mkdir()   // tmp ist ein Verzeichnis -> writeBytes wirft -> alte Datei muss bleiben
        assertEquals(false, CmPriceFile.ersetzen(tmp, ziel, byteArrayOf(3, 4)))
        assertEquals(listOf<Byte>(9), ziel.readBytes().toList())
    }

    @Test
    fun `faellig - ohne Datei sofort, sonst nach 24 h`() {
        val h = 3_600_000L
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 1000, dateiDa = false))
        assertEquals(false, CmPriceFile.faellig(lastMs = 0, nowMs = 23 * h, dateiDa = true))
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 24 * h, dateiDa = true))
    }
}
