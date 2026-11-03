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

    // --- Spec 2026-11-03 §3.5: reiner Kern lauf ---

    private val gut = CmPriceFile.Preise("2026-11-03", mapOf(1 to 1.0), emptyMap())

    private fun lauf(
        ausDatei: Boolean = false, faellig: Boolean = true, download: CmPriceFile.Download = CmPriceFile.Download.Bytes(byteArrayOf(1)),
        parse: CmPriceFile.Preise? = gut, schreiben: Boolean = true,
    ): Triple<CmPriceFile.Lauf, String?, List<CmPriceFile.Preise>> {
        val gesetzt = ArrayList<CmPriceFile.Preise>()
        var geladen = 0
        val (l, f) = CmPriceFile.lauf(ausDatei, faellig, { geladen++; download }, { parse }, { schreiben }, { gesetzt += it })
        if (!faellig) assertEquals("nicht faellig -> kein Download", 0, geladen)
        return Triple(l, f, gesetzt)
    }

    @Test
    fun `lauf - nicht faellig`() {
        assertEquals(Triple(CmPriceFile.Lauf.AUS_DATEI, null, emptyList<CmPriceFile.Preise>()), lauf(ausDatei = true, faellig = false))
        assertEquals(Triple(CmPriceFile.Lauf.NICHT_FAELLIG, null, emptyList<CmPriceFile.Preise>()), lauf(ausDatei = false, faellig = false))
    }

    @Test
    fun `lauf - Fehlerarten mit Text, nichts gesetzt`() {
        assertEquals(Triple(CmPriceFile.Lauf.OFFLINE, "offline", emptyList<CmPriceFile.Preise>()), lauf(download = CmPriceFile.Download.Offline))
        assertEquals(Triple(CmPriceFile.Lauf.HTTP_FEHLER, "HTTP 404", emptyList<CmPriceFile.Preise>()), lauf(download = CmPriceFile.Download.Http(404)))
        assertEquals(Triple(CmPriceFile.Lauf.KAPUTT, "Datei unlesbar", emptyList<CmPriceFile.Preise>()), lauf(parse = null))
        assertEquals(Triple(CmPriceFile.Lauf.SCHREIBFEHLER, "Speichern fehlgeschlagen", emptyList<CmPriceFile.Preise>()), lauf(schreiben = false))
    }

    @Test
    fun `lauf - geladen setzt die neuen Preise`() {
        assertEquals(Triple(CmPriceFile.Lauf.GELADEN, null, listOf(gut)), lauf())
    }

    @Test
    fun `letzterFehler - Regel je Lauf`() {
        assertEquals("offline", CmPriceFile.naechsterFehler("alt", CmPriceFile.Lauf.OFFLINE, "offline"))
        assertEquals(null, CmPriceFile.naechsterFehler("alt", CmPriceFile.Lauf.GELADEN, null))
        assertEquals(null, CmPriceFile.naechsterFehler("alt", CmPriceFile.Lauf.AUS_DATEI, null))
        assertEquals(null, CmPriceFile.naechsterFehler("alt", CmPriceFile.Lauf.NICHT_FAELLIG, null))
        assertEquals("alt", CmPriceFile.naechsterFehler("alt", CmPriceFile.Lauf.BESETZT, null))
    }

    @Test
    fun `faellig - ohne Datei sofort, sonst nach 24 h`() {
        val h = 3_600_000L
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 1000, dateiDa = false))
        assertEquals(false, CmPriceFile.faellig(lastMs = 0, nowMs = 23 * h, dateiDa = true))
        assertTrue(CmPriceFile.faellig(lastMs = 0, nowMs = 24 * h, dateiDa = true))
    }
}
