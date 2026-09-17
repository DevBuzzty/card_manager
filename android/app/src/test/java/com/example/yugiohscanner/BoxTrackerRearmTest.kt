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
 * BoxTracker sie darum nie ein zweites Mal (siehe StackMotion/brief.md). rearm() setzt genau den
 * Zustand zurueck, den [BoxTracker.update] fuer eine neue Bestaetigung braucht.
 */
class BoxTrackerRearmTest {

    private fun det(pc: Int) = Detection(Box(0f, 0f, 10f, 10f, 1f), pc, 1f, emptyMap(), "")

    @Test fun `nach rearm bestaetigt dieselbe anwesende Karte nach need weiteren Bildern erneut`() {
        val t = BoxTracker(need = 2, maxMisses = 8)
        // Erste Bestaetigung: zwei Bilder mit derselben Karte.
        t.update(listOf(det(111)))
        val firstConfirm = t.update(listOf(det(111)))
        assertEquals(listOf(111), firstConfirm.map { it.passcode })

        // Karte bleibt ununterbrochen sichtbar (sie liegt weiter im Fach) -- ohne rearm keine
        // zweite Bestaetigung, egal wie viele weitere Bilder kommen.
        repeat(5) {
            val r = t.update(listOf(det(111)))
            assertTrue("ohne rearm keine erneute Bestaetigung", r.isEmpty())
        }

        t.rearm(listOf(111))

        // Braucht wieder [need] Treffer.
        val afterRearmFirstHit = t.update(listOf(det(111)))
        assertTrue("erster Treffer nach rearm reicht noch nicht", afterRearmFirstHit.isEmpty())
        val secondConfirm = t.update(listOf(det(111)))
        assertEquals(listOf(111), secondConfirm.map { it.passcode })
    }

    @Test fun `rearm betrifft nur die genannten Passcodes`() {
        val t = BoxTracker(need = 1, maxMisses = 8)
        t.update(listOf(det(1), det(2)))

        t.rearm(listOf(1))

        // 1 braucht wieder eine Bestaetigung, 2 bleibt bestaetigt (kein erneuter Treffer).
        val r = t.update(listOf(det(1), det(2)))
        assertEquals(listOf(1), r.map { it.passcode })
    }
}
