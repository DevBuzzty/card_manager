package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Box
import com.example.yugiohscanner.ml.BoxTracker
import com.example.yugiohscanner.ml.Detection
import com.example.yugiohscanner.ml.StackMotion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BoxTracker.rearm() (Stapel-Scan-Fix): wenn dieselbe Karte im Modus "stapel" auf eine bereits
 * liegende gleiche Karte rutscht, bleibt ihr Passcode ununterbrochen sichtbar -- ohne rearm bestaetigt
 * BoxTracker sie darum nie ein zweites Mal (siehe StackMotion/brief.md). rearm() setzt genau den
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

    // "HH:mm:ss.SSS" -> ms seit Mitternacht (wie in StackMotionTest).
    private fun t(s: String): Long {
        val (hms, ms) = s.split(".")
        val (h, m, sec) = hms.split(":")
        return ((h.toLong() * 60 + m.toLong()) * 60 + sec.toLong()) * 1000 + ms.toLong()
    }

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

    @Test fun `Karte 1 -- StackMotion plus rearm verzoegert die erste Bestaetigung nicht`() {
        // Zeitreihe aus messung-1.txt, Karte 1: leeres Fach, dann eine Karte hinein. Kein
        // Einrutschen auf eine andere Karte -- die erste Bestaetigung darf durch die
        // StackMotion+rearm-Verdrahtung (ScanScreen, Modus "stapel") nicht verzoegert oder
        // verhindert werden. need=4 wie im echten Scanner (ScanScreen.kt).
        data class Frame(val ts: String, val diff: Double, val pcs: List<Int>)
        val frames = listOf(
            Frame("11:24:35.654", 6.6, emptyList()),
            Frame("11:24:35.813", 18.0, emptyList()),
            Frame("11:24:36.320", 21.7, listOf(81916745)),
            Frame("11:24:36.763", 8.7, listOf(81916745)),
            Frame("11:24:37.250", 1.4, listOf(81916745)),
            Frame("11:24:37.701", 1.3, listOf(81916745)),
        )

        // Ohne StackMotion (Modus "einzeln"): nur der Tracker.
        val plainTracker = BoxTracker(need = 4)
        val plainConfirmedAt = frames.indices.filter { i ->
            plainTracker.update(frames[i].pcs.map(::det)).isNotEmpty()
        }

        // Mit StackMotion + rearm (Modus "stapel"), wie in ScanScreen verdrahtet.
        val stackMotion = StackMotion()
        val stapelTracker = BoxTracker(need = 4)
        val stapelConfirmedAt = frames.indices.filter { i ->
            val f = frames[i]
            val dets = f.pcs.map(::det)
            val meldung = stackMotion.update(f.diff, t(f.ts))
            val decision = stackMotion.lastDecision
            if (meldung && decision != null) {
                stapelTracker.rearm(dets.map { it.passcode }, decision.unrestStartMs)
            }
            stapelTracker.update(dets, t(f.ts)).isNotEmpty()
        }

        assertEquals("genau eine Bestaetigung, im Bild der vierten Stimme (Index 5)", listOf(5), plainConfirmedAt)
        assertEquals(
            "StackMotion+rearm bestaetigt im selben Bild wie ohne StackMotion",
            plainConfirmedAt, stapelConfirmedAt,
        )
    }

    @Test fun `Karte 2 -- rearm greift, wenn die Bestaetigung lange vor der Unruhe lag`() {
        // Fortsetzung der Karte-1-Zeitreihe aus messung-1.txt: Karte 1 bestaetigt bei 37.701, liegt
        // dann gut 13,5 s ruhig (diff durchgehend 1.2-1.5, hier ausgelassen -- inert fuer beide
        // Automaten), bevor Karte 2 auf sie rutscht (Unruhe ab 51.398, Meldung bei 53.105). Die
        // Bestaetigung liegt WEIT vor dieser Unruhe -- rearm muss hier greifen (Gegenprobe zu
        // Kritisch #2, das rearm fuer waehrend der Unruhe bestaetigte Karten unterdrueckt).
        data class Frame(val ts: String, val diff: Double, val pcs: List<Int>)
        val frames = listOf(
            Frame("11:24:35.654", 6.6, emptyList()),
            Frame("11:24:35.813", 18.0, emptyList()),
            Frame("11:24:36.320", 21.7, listOf(81916745)),
            Frame("11:24:36.763", 8.7, listOf(81916745)),
            Frame("11:24:37.250", 1.4, listOf(81916745)),
            Frame("11:24:37.701", 1.3, listOf(81916745)), // 4. Stimme -> bestaetigt
            Frame("11:24:51.398", 16.3, emptyList()),
            Frame("11:24:51.796", 16.1, listOf(81916745)),
            Frame("11:24:52.237", 9.5, listOf(81916745)),
            Frame("11:24:52.678", 1.4, listOf(81916745)),
            Frame("11:24:53.105", 1.3, listOf(81916745)), // 2. ruhiges Bild -> Meldung
        )

        val stackMotion = StackMotion()
        val tracker = BoxTracker(need = 4)
        var confirmations = 0
        var rearmedAtMeldung: Set<Int>? = null
        for (f in frames) {
            val dets = f.pcs.map(::det)
            val meldung = stackMotion.update(f.diff, t(f.ts))
            val decision = stackMotion.lastDecision
            if (meldung && decision != null) {
                rearmedAtMeldung = tracker.rearm(dets.map { it.passcode }, decision.unrestStartMs)
            }
            confirmations += tracker.update(dets, t(f.ts)).size
        }

        assertEquals("nur Karte 1s eigene Ankunft bestaetigt in dieser Zeitreihe", 1, confirmations)
        assertEquals(
            "die laengst bestaetigte Karte 1 wird von Karte 2s Meldung rearmt",
            setOf(81916745), rearmedAtMeldung,
        )
    }

    @Test fun `Kritisch #2 -- eine WAEHREND der Unruhe bestaetigte Karte wird von derselben Meldung nicht rearmt`() {
        // Rekonstruiert aus messung-2-roh.log, 11:50:00.267-01.639 (Karte faellt in ein leeres
        // Fach): die drei geloggten Punkte (12,5@00.267, 13,8@00.468, 7,6@00.632) sind exakt aus
        // dem Log; Zwischenbilder mit diff < 4 werden dort NICHT geloggt (siehe
        // MlScanAnalyzer-Schwelle) und sind hier rekonstruiert, ebenso wie der Zeitpunkt der
        // vierten Stimme -- belegt ist nur, dass "confirmed card" (bei ca. 01.163) VOR der
        // Meldung (01.639) lag und dass genau diese Meldung dort mit `diff=1,8 dauer=364` geloggt
        // wurde (beides hier uebernommen). Ohne die Kritisch-#2-Schranke haette rearm die frisch
        // bestaetigte Karte sofort zurueckgesetzt und ein zweites Mal bestaetigt.
        data class Frame(val ts: String, val diff: Double, val pcs: List<Int>)
        val frames = listOf(
            Frame("11:50:00.267", 12.5, emptyList()),          // Unruhe beginnt (Log)
            Frame("11:50:00.468", 13.8, listOf(81916745)),     // Stimme 1 (Log)
            Frame("11:50:00.632", 7.6, listOf(81916745)),      // Stimme 2, letztes Bild >= UNRUHE (Log)
            Frame("11:50:00.784", 2.0, listOf(81916745)),      // Stimme 3, ruhig (rekonstruiert)
            Frame("11:50:00.960", 3.5, listOf(81916745)),      // Stimme 4 -> bestaetigt (rekonstruiert)
            Frame("11:50:01.164", 2.0, listOf(81916745)),      // ruhig (rekonstruiert)
            Frame("11:50:01.639", 1.8, listOf(81916745)),      // 2. ruhiges Bild -> Meldung (Log: diff=1,8 dauer=364)
        )

        val stackMotion = StackMotion()
        val tracker = BoxTracker(need = 4)
        var confirmations = 0
        var rearmedAtMeldung: Set<Int>? = null
        for (f in frames) {
            val dets = f.pcs.map(::det)
            val meldung = stackMotion.update(f.diff, t(f.ts))
            val decision = stackMotion.lastDecision
            if (meldung && decision != null) {
                rearmedAtMeldung = tracker.rearm(dets.map { it.passcode }, decision.unrestStartMs)
            }
            confirmations += tracker.update(dets, t(f.ts)).size
        }

        assertEquals("nur die eine Ankunft bestaetigt, kein Doppelzaehlen", 1, confirmations)
        assertTrue(
            "die waehrend der Unruhe bestaetigte Karte wird von dieser Meldung NICHT rearmt",
            rearmedAtMeldung?.isEmpty() != false,
        )
    }
}
