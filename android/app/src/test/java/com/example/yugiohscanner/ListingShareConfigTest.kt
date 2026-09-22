package com.example.yugiohscanner

import com.example.yugiohscanner.ui.ListingShare
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Spec H3a §5.6 -- Bilder teilen braucht einen FileProvider. Ohne ihn wirft getUriForFile erst am Gerät; diese Tests
 * lesen Manifest und Pfad-Datei (wie AndroidRegexWaechterTest die Quellen), damit Code und Konfiguration zusammenpassen.
 */
class ListingShareConfigTest {
    @Test fun `Manifest meldet den FileProvider mit passender Authority und Pfad-Datei`() {
        val m = File("src/main/AndroidManifest.xml").readText()
        assertTrue(m.contains("androidx.core.content.FileProvider"))
        assertTrue(m.contains("android:authorities=\"\${applicationId}${ListingShare.AUTHORITY_SUFFIX}\""))
        assertTrue(m.contains("android:exported=\"false\""))
        assertTrue(m.contains("android:grantUriPermissions=\"true\""))
        assertTrue(m.contains("@xml/file_paths"))
    }
    @Test fun `Pfad-Datei gibt genau den Cache-Ordner der Bilder frei`() {
        val x = File("src/main/res/xml/file_paths.xml").readText()
        assertTrue(x.contains("<cache-path"))
        assertTrue(x.contains("path=\"${ListingShare.CACHE_DIR}/\""))
    }
    @Test fun `Dateinamen wie am PC`() {
        assertEquals("01.jpg", ListingShare.fileName(0, "https://a/b/46986414.jpg"))
        assertEquals("10.png", ListingShare.fileName(9, "https://a/b/x.PNG?v=2"))
        assertEquals("03.jpg", ListingShare.fileName(2, "https://a/b/x"))
    }
}
