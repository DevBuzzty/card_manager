package com.example.yugiohscanner

import com.example.yugiohscanner.ml.StackMotion
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Testdaten aus docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/messung-1.txt (Spalten:
 * Uhrzeit, Bildaenderung). Zeitstempel als Millisekunden seit Mitternacht, damit Differenzen
 * (Unruhe-Dauer) genau den in brief.md genannten Werten entsprechen.
 */
class StackMotionTest {

    // "HH:mm:ss.SSS" -> ms seit Mitternacht.
    private fun t(s: String): Long {
        val (hms, ms) = s.split(".")
        val (h, m, sec) = hms.split(":")
        return ((h.toLong() * 60 + m.toLong()) * 60 + sec.toLong()) * 1000 + ms.toLong()
    }

    private fun run(vararg frames: Pair<String, Double>): List<Boolean> {
        val sm = StackMotion()
        return frames.map { (ts, diff) -> sm.update(diff, t(ts)) }
    }

    @Test fun `Karte 2 -- einrutschen meldet genau einmal`() {
        val r = run(
            "11:24:51.398" to 16.3,
            "11:24:51.796" to 16.1,
            "11:24:52.237" to 9.5,
            "11:24:52.678" to 1.4,
            "11:24:53.105" to 1.3,
        )
        assertEquals(listOf(false, false, false, false, true), r)
    }

    @Test fun `Karte 3 -- einrutschen meldet genau einmal, auch mit Zwischenwert nahe RUHE`() {
        val r = run(
            "11:24:56.929" to 4.7,
            "11:24:57.402" to 10.6,
            "11:24:57.829" to 3.1, // zwischen RUHE und UNRUHE -- unterbricht nur die Ruhe-Zaehlung
            "11:24:58.250" to 1.4,
            "11:24:58.697" to 1.4,
        )
        assertEquals(listOf(false, false, false, false, true), r)
    }

    @Test fun `Karte 4 -- einrutschen meldet genau einmal`() {
        val r = run(
            "11:25:01.846" to 11.5,
            "11:25:02.280" to 15.9,
            "11:25:02.685" to 6.2,
            "11:25:03.083" to 1.4,
            "11:25:03.501" to 1.4,
        )
        assertEquals(listOf(false, false, false, false, true), r)
    }

    @Test fun `Hand-Wackeln -- Unruhe zu lang, keine Meldung`() {
        val r = run(
            "11:25:13.850" to 7.7,
            "11:25:14.268" to 8.2,
            "11:25:14.695" to 7.3,
            "11:25:15.125" to 10.1,
            "11:25:15.547" to 9.2,
            "11:25:15.962" to 2.9,
            "11:25:16.383" to 1.4,
        )
        assertEquals(r, r.map { false })
    }

    @Test fun `Karten herausnehmen -- lange Unruhe, keine Meldung ueber StackMotion`() {
        val r = run(
            "11:25:18.808" to 36.2,
            "11:25:19.004" to 23.0,
            "11:25:19.171" to 12.5,
            "11:25:19.441" to 17.8,
            "11:25:19.595" to 21.7,
            "11:25:19.837" to 11.1,
            "11:25:20.064" to 12.4,
            "11:25:20.280" to 13.9,
            "11:25:20.474" to 9.7,
            "11:25:20.697" to 9.7,
            "11:25:20.864" to 10.9,
            "11:25:21.025" to 6.8,
            "11:25:21.262" to 6.8,
            "11:25:21.423" to 7.5,
            "11:25:21.575" to 5.7,
            "11:25:21.812" to 9.0,
            "11:25:21.979" to 6.4,
            "11:25:22.147" to 8.0,
            "11:25:22.379" to 8.8,
            "11:25:22.533" to 12.2,
            "11:25:22.716" to 11.7,
            "11:25:22.910" to 18.7,
            "11:25:23.063" to 53.0,
            "11:25:23.487" to 22.3,
            "11:25:23.960" to 9.0,
            "11:25:24.393" to 1.6,
            "11:25:24.851" to 1.5,
        )
        assertEquals(r, r.map { false })
    }

    @Test fun `Ruhephase -- diff bleibt unter UNRUHE, keine Meldung`() {
        val r = run(
            "11:24:37.250" to 1.4,
            "11:24:37.701" to 1.3,
            "11:24:38.212" to 1.4,
            "11:24:38.639" to 1.3,
            "11:24:39.071" to 1.3,
            "11:24:39.571" to 1.4,
            "11:24:40.023" to 1.3,
            "11:24:40.487" to 1.4,
            "11:24:40.922" to 1.3,
            "11:24:41.370" to 1.2,
        )
        assertEquals(r, r.map { false })
    }

    @Test fun `erstes Bild diff -1 wird ignoriert`() {
        val r = run("11:24:09.730" to -1.0)
        assertEquals(listOf(false), r)
    }
}
