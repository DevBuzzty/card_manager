package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Box
import com.example.yugiohscanner.ml.BoxTracker
import com.example.yugiohscanner.ml.Detection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BoxTracker.rearm() (Stapel-Scan-Fix): wenn dieselbe Karte im Modus "stapel" auf eine bereits
 * liegende gleiche Karte rutscht, bleibt ihr Passcode ununterbrochen sichtbar -- ohne rearm bestaetigt
 * BoxTracker sie darum nie ein zweites Mal (siehe docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/brief.md). rearm() setzt genau den
 * Zustand zurueck, den [BoxTracker.update] fuer eine neue Bestaetigung braucht.
 *
 * Fix Runde 1 (Review von 3c5f3f6, Kritisch #1): rearm() darf nur bereits BESTAETIGTE Passcodes
 * zuruecksetzen. [passcodes] enthaelt beim echten Aufruf (ScanScreen) ALLE aktuell erkannten
 * Karten -- auch eine, die in genau diesem Bild ihre vierte Stimme bekommen wuerde und vorher
 * NICHT bestaetigt war. Ein bedingungsloses `votes.remove` hat diese Stimme geloescht und die
 * erste Bestaetigung verzoegert/verschluckt (siehe Karte 1 in messung-1.txt).
 *
 * Fix Runde 1 (Review von 3c5f3f6, Kritisch #2): das reicht allein nicht -- messung-2-roh.log
 * zeigt eine Karte, die WAEHREND der Unruhe bestaetigt wird, die dieselbe Ankunft ausloest (die
 * Unruhe beginnt schon vor dem ersten Erkennen, die Bestaetigung faellt mitten hinein, die
 * Meldung selbst erst danach). Dann ist der Passcode zum Meldungszeitpunkt laengst emittiert, das
 * Kritisch-#1-Gatter allein haelt also nicht mehr. rearm() nimmt daher zusaetzlich den Beginn der
 * Unruhe entgegen und rearmt nur, wessen Bestaetigung VOR diesem Zeitpunkt lag.
 */
class BoxTrackerRearmTest {

    private fun det(pc: Int) = Detection(Box(0f, 0f, 10f, 10f, 1f), pc, 1f, emptyMap(), "")

    @Test fun `nach rearm bestaetigt dieselbe anwesende Karte nach need weiteren Bildern erneut`() {
        val tr = BoxTracker(need = 2, maxMisses = 8)
        // Erste Bestaetigung: zwei Bilder mit derselben Karte.
        tr.update(listOf(det(111)))
        val firstConfirm = tr.update(listOf(det(111)))
        assertEquals(listOf(111), firstConfirm.map { it.passcode })

        // Karte bleibt ununterbrochen sichtbar (sie liegt weiter im Fach) -- ohne rearm keine
        // zweite Bestaetigung, egal wie viele weitere Bilder kommen.
        repeat(5) {
            val r = tr.update(listOf(det(111)))
            assertTrue("ohne rearm keine erneute Bestaetigung", r.isEmpty())
        }

        // Long.MAX_VALUE: dieser Test prueft die generelle Rearm-Faehigkeit, keine Unruhe-Grenze.
        val rearmed = tr.rearm(listOf(111), Long.MAX_VALUE)
        assertEquals("111 war bestaetigt, wird also tatsaechlich rearmt", setOf(111), rearmed)

        // Braucht wieder [need] Treffer.
        val afterRearmFirstHit = tr.update(listOf(det(111)))
        assertTrue("erster Treffer nach rearm reicht noch nicht", afterRearmFirstHit.isEmpty())
        val secondConfirm = tr.update(listOf(det(111)))
        assertEquals(listOf(111), secondConfirm.map { it.passcode })
    }

    @Test fun `rearm betrifft nur die genannten Passcodes`() {
        val tr = BoxTracker(need = 1, maxMisses = 8)
        tr.update(listOf(det(1), det(2)))

        val rearmed = tr.rearm(listOf(1), Long.MAX_VALUE)
        assertEquals(setOf(1), rearmed)

        // 1 braucht wieder eine Bestaetigung, 2 bleibt bestaetigt (kein erneuter Treffer).
        val r = tr.update(listOf(det(1), det(2)))
        assertEquals(listOf(1), r.map { it.passcode })
    }

    @Test fun `rearm auf einen noch NICHT bestaetigten Passcode laesst seine Stimmen unangetastet`() {
        val tr = BoxTracker(need = 4, maxMisses = 8)
        // Drei Stimmen -- noch nicht bestaetigt.
        repeat(3) {
            val r = tr.update(listOf(det(555)))
            assertTrue(r.isEmpty())
        }

        val rearmed = tr.rearm(listOf(555), Long.MAX_VALUE)
        assertTrue("555 war nicht bestaetigt, rearm betrifft es also nicht", rearmed.isEmpty())

        // Die vierte Stimme darf NICHT verzoegert sein -- ohne den Fix wuerden die drei
        // vorherigen Stimmen hier geloescht und es braeuchte drei weitere Bilder.
        val fourthHit = tr.update(listOf(det(555)))
        assertEquals(
            "die vierte Stimme bestaetigt sofort, rearm hat die ersten drei nicht geloescht",
            listOf(555), fourthHit.map { it.passcode },
        )
    }
}
