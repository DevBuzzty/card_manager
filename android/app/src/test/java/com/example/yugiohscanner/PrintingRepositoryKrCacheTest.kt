package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.ScanCache
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * cachedKoreanSets liest die KR-Drucke fuer den Katalog-Pfad aus dem Plattenspeicher -- ohne Netz.
 * Nur der Treffer-Fall wird geprueft; der Fehlschlag-Fall startet absichtlich einen Netzabruf.
 */
class PrintingRepositoryKrCacheTest {
    private lateinit var tmp: File
    private val dirField = ScanCache::class.java.getDeclaredField("dir").apply { isAccessible = true }

    @Before fun setUp() {
        tmp = Files.createTempDirectory("scan_cache").toFile()
        dirField.set(null, tmp)
    }

    @After fun tearDown() {
        dirField.set(null, null)
        tmp.deleteRecursively()
    }

    @Test fun `KR-Drucke kommen aus dem Zwischenspeicher, ohne erfundene Rarity`() {
        File(tmp, "sets-kr-v1_46986414.json").writeText(
            """[{"c":"LOB-KR001","r":"Ultra Rare","p":0,"l":"KR"},{"c":"LOB-KR001","r":"","p":0,"l":"KR"}]"""
        )
        val kr = PrintingRepository.cachedKoreanSets("46986414")
        assertEquals(1, kr.size)
        assertEquals("LOB-KR001", kr[0].setCode)
        assertEquals("Ultra Rare", kr[0].rarity)
        assertEquals("KR", kr[0].language)
    }
}
