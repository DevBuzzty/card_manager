package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ChuteGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Testdaten: jedes Kamerabild der Messung docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/
 * messung-1-roh.log (Test-Ressource stapel-lichtschranke-messung-1.csv). Nutzer: 4 Karten, Stapel
 * raus, Karten, raus (zweimal nachgegriffen), Karten, raus, Hand von rechts.
 */
class ChuteGateTest {

    private fun messung(): List<Pair<Long, Double>> =
        javaClass.classLoader!!.getResourceAsStream("stapel-lichtschranke-messung-1.csv")!!
            .bufferedReader().readLines()
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .map { val (t, s) = it.split(","); t.toLong() to s.toDouble() }

    @Test fun `Messung 1 -- alle 14 Einwuerfe gezaehlt, Hand und Herausnehmen nicht`() {
        val frames = messung()
        val t0 = frames.first().first
        val gate = ChuteGate()
        val bursts = frames.mapNotNull { (t, s) -> gate.update(s, t) }
        val einwuerfe = bursts.filter { it.einwurf }.map { it.startMs - t0 }

        val erwartet = listOf(31290L, 35120, 39530, 44090, 53990, 57080, 66410, 72600, 86660, 93160,
            107840, 110780, 115180, 122640)
        assertEquals(erwartet.size, einwuerfe.size)
        for ((e, a) in erwartet.zip(einwuerfe)) assertTrue("Einwurf bei $e ms, gefunden $a", kotlin.math.abs(e - a) <= 50)

        // Herausnehmen (~48 s, ~81 s, ~97 s, ~103 s, ~127 s) und Hand von rechts (~139-145 s):
        // gross, aber kein Einwurf.
        val verworfenGross = bursts.filter { !it.einwurf && it.peak >= 13 }.map { it.startMs - t0 }
        assertTrue("Hand von rechts erkannt und verworfen", verworfenGross.any { it in 139_000..146_000 })
        assertTrue("Herausnehmen erkannt und verworfen", verworfenGross.any { it in 81_000..86_000 })
    }

    @Test fun `langer Stoss mit hoher Spitze ist kein Einwurf`() {
        val gate = ChuteGate()
        var t = 0L
        for (s in listOf(10.0, 80.0, 20.0, 20.0, 20.0)) { assertNull(gate.update(s, t)); t += 200 }
        gate.update(0.3, t); gate.update(0.3, t + 35)
        val b = gate.update(0.3, t + 70)!!
        assertFalse(b.einwurf)
        assertEquals(800L, b.dauerMs)
    }

    @Test fun `Einwurf wird erst nach drei ruhigen Bildern gemeldet`() {
        val gate = ChuteGate()
        assertNull(gate.update(-1.0, 0))
        assertNull(gate.update(70.0, 35))
        assertNull(gate.update(30.0, 70))
        assertNull(gate.update(0.3, 105))
        assertNull(gate.update(0.3, 140))
        val b = gate.update(0.3, 175)!!
        assertTrue(b.einwurf)
        assertEquals(35L, b.startMs)
    }
}
