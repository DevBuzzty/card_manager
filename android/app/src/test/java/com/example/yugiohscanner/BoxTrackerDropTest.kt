package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Box
import com.example.yugiohscanner.ml.BoxTracker
import com.example.yugiohscanner.ml.Detection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BoxTracker meldet, welche Karten endgueltig aus dem Bild sind.
 *
 * Gebraucht seit Spec D3 Task 6: ScanScreen raeumt die OCR-Belege einer Karte nicht mehr bei der
 * Bestaetigung ab, weil die stille Verbesserung sie noch braucht. Ohne ein Signal fuer "jetzt ist
 * sie wirklich weg" waechst SetCodeEvidence ueber eine lange Sitzung unbegrenzt -- und der
 * Speed-Scan aus D4 schiebt Hunderte Karten durch eine einzige Sitzung.
 */
class BoxTrackerDropTest {

    private fun det(pc: Int) = Detection(Box(0f, 0f, 10f, 10f, 1f), pc, 1f, emptyMap(), "")

    @Test fun `eine noch sichtbare Karte wird nicht gemeldet`() {
        val t = BoxTracker(need = 2, maxMisses = 3)
        repeat(5) { t.update(listOf(det(111))) }
        assertTrue("solange sie zu sehen ist, faellt nichts ab", t.droppedThisFrame.isEmpty())
    }

    @Test fun `kurzes Verdecken meldet nichts, dauerhaftes Verschwinden schon`() {
        val t = BoxTracker(need = 2, maxMisses = 3)
        t.update(listOf(det(111))); t.update(listOf(det(111)))
        // Kurz verdeckt: unter maxMisses, also noch kein Abgang.
        repeat(3) { t.update(emptyList()); assertTrue(t.droppedThisFrame.isEmpty()) }
        // Ein Frame mehr, und sie gilt als weg.
        t.update(emptyList())
        assertEquals(listOf(111), t.droppedThisFrame)
    }

    @Test fun `die Meldung gilt nur fuer den einen Frame`() {
        val t = BoxTracker(need = 2, maxMisses = 1)
        t.update(listOf(det(222))); t.update(listOf(det(222)))
        t.update(emptyList()); t.update(emptyList())
        assertEquals(listOf(222), t.droppedThisFrame)
        t.update(emptyList())
        assertTrue("kein Nachhall im naechsten Frame", t.droppedThisFrame.isEmpty())
    }

    @Test fun `reset raeumt auch die Abgangsliste`() {
        val t = BoxTracker(need = 2, maxMisses = 1)
        t.update(listOf(det(333))); t.update(listOf(det(333)))
        t.update(emptyList()); t.update(emptyList())
        assertTrue(t.droppedThisFrame.isNotEmpty())
        t.reset()
        assertTrue(t.droppedThisFrame.isEmpty())
    }
}
