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

    @Test fun `Einwurf wird erst gemeldet, wenn ABSTAND_MS nach Stossende nichts kam`() {
        val gate = ChuteGate()
        assertNull(gate.update(-1.0, 0))
        assertNull(gate.update(70.0, 35))
        assertNull(gate.update(30.0, 70))
        var t = 105L
        while (t < 70 + ChuteGate.ABSTAND_MS) { assertNull("t=$t", gate.update(0.3, t)); t += 35 }
        val b = gate.update(0.3, t)!!
        assertTrue(b.einwurf)
        assertEquals(35L, b.startMs)
    }

    @Test fun `kurzer starker Stoss mit Nachbar direkt danach ist kein Einwurf`() {
        // Hand-Wackeln, abnahme-1 ~159 s: Stoesse im Abstand von 0,3 s.
        val gate = ChuteGate()
        val einwuerfe = ArrayList<ChuteGate.Burst>()
        var t = 0L
        fun feed(s: Double) { gate.update(s, t)?.let { if (it.einwurf) einwuerfe.add(it) }; t += 35 }
        repeat(20) { feed(0.3) }
        repeat(12) { feed(38.6) }
        repeat(8) { feed(0.3) }
        repeat(6) { feed(26.2) }
        repeat(60) { feed(0.3) }
        assertTrue(einwuerfe.isEmpty())
    }

    /**
     * Abnahme-Logs enthalten nur die Stoesse (Beginn ms seit Scanner-Start, Dauer, Spitze), keine
     * Einzelbilder. Daraus ~28 Bilder/s nachbauen: im Stoss strip = Spitze, sonst Ruhe 0,3.
     */
    private fun nachgebaut(stoesse: List<Triple<Long, Long, Double>>): List<Long> {
        val gate = ChuteGate()
        val ende = stoesse.maxOf { it.first + it.second } + 3_000
        val out = ArrayList<Long>()
        var t = 0L
        while (t <= ende) {
            val s = stoesse.firstOrNull { t >= it.first && t <= it.first + it.second }?.third ?: 0.3
            gate.update(s, t)?.let { if (it.einwurf) out.add(it.startMs) }
            t += 35
        }
        return out
    }

    private fun pruefe(einwuerfe: List<Long>, karten: List<Long>, unklar: List<Long>) {
        val ohneUnklar = einwuerfe.filter { e -> unklar.none { kotlin.math.abs(it - e) <= 60 } }
        assertEquals("Einwuerfe $ohneUnklar", karten.size, ohneUnklar.size)
        for ((k, e) in karten.zip(ohneUnklar)) assertTrue("Karte bei $k ms, gefunden $e", kotlin.math.abs(k - e) <= 60)
    }

    @Test fun `Abnahme 1 -- 9 Karten, Hand-Wackeln verworfen`() {
        // abnahme-1-roh.log. 105 000 ms unklar (Nutzer: +4 sprang bei EINER Karte auf +6).
        val stoesse = listOf(
            Triple(1078L, 876L, 35.7),
            Triple(3185L, 632L, 44.0),
            Triple(3951L, 1664L, 81.2),
            Triple(6481L, 516L, 17.6),
            Triple(42003L, 0L, 3.3),
            Triple(42762L, 233L, 70.5),
            Triple(45760L, 238L, 13.4),
            Triple(46192L, 64L, 4.8),
            Triple(47756L, 2531L, 12.6),
            Triple(50554L, 767L, 8.2),
            Triple(51552L, 0L, 4.0),
            Triple(52951L, 35L, 6.8),
            Triple(56251L, 168L, 54.4),
            Triple(60915L, 234L, 57.2),
            Triple(66443L, 233L, 63.5),
            Triple(70807L, 173L, 75.2),
            Triple(84876L, 145L, 4.4),
            Triple(87930L, 201L, 9.6),
            Triple(90931L, 131L, 5.1),
            Triple(91395L, 133L, 8.9),
            Triple(91669L, 2291L, 22.9),
            Triple(94227L, 38L, 5.0),
            Triple(104558L, 30L, 6.8),
            Triple(104997L, 555L, 54.5),
            Triple(105685L, 0L, 3.3),
            Triple(105958L, 294L, 11.1),
            Triple(106521L, 330L, 13.2),
            Triple(106993L, 363L, 20.9),
            Triple(107766L, 321L, 20.9),
            Triple(108520L, 765L, 34.6),
            Triple(109588L, 67L, 3.5),
            Triple(111448L, 207L, 74.4),
            Triple(113222L, 93L, 31.8),
            Triple(119712L, 430L, 54.5),
            Triple(126906L, 303L, 64.6),
            Triple(133837L, 401L, 58.2),
            Triple(141038L, 0L, 5.2),
            Triple(149623L, 407L, 7.3),
            Triple(150456L, 233L, 6.6),
            Triple(150855L, 0L, 3.3),
            Triple(151023L, 1400L, 39.2),
            Triple(152692L, 30L, 7.7),
            Triple(158252L, 740L, 43.0),
            Triple(159221L, 364L, 26.2),
            Triple(159852L, 432L, 38.6),
            Triple(160456L, 131L, 11.5),
            Triple(161016L, 0L, 5.7),
        )
        pruefe(nachgebaut(stoesse),
            listOf(42_762L, 56_251, 60_915, 66_443, 70_807, 111_448, 119_712, 126_906, 133_837), listOf(104_997L))
    }

    @Test fun `Abnahme 2 -- 10 Karten inklusive der zwei schwachen (Spitze 43,6 und 42,7)`() {
        // abnahme-2-roh.log. 11 322 ms unklar (Spitze 193,9 beim Einrichten).
        val stoesse = listOf(
            Triple(789L, 174L, 13.7),
            Triple(11322L, 434L, 193.9),
            Triple(11988L, 0L, 3.3),
            Triple(12632L, 133L, 7.1),
            Triple(13073L, 0L, 3.2),
            Triple(13366L, 135L, 5.5),
            Triple(14022L, 200L, 6.4),
            Triple(19152L, 0L, 3.1),
            Triple(24990L, 190L, 4.8),
            Triple(25413L, 168L, 6.6),
            Triple(26548L, 197L, 30.4),
            Triple(28376L, 268L, 6.1),
            Triple(28778L, 1298L, 23.1),
            Triple(30211L, 463L, 15.0),
            Triple(39805L, 156L, 5.6),
            Triple(40171L, 0L, 3.9),
            Triple(40406L, 0L, 4.9),
            Triple(40609L, 0L, 3.1),
            Triple(40769L, 0L, 5.1),
            Triple(41003L, 1172L, 25.2),
            Triple(45972L, 197L, 53.3),
            Triple(49529L, 202L, 55.7),
            Triple(54363L, 165L, 59.1),
            Triple(58857L, 199L, 43.6),
            Triple(74149L, 243L, 72.2),
            Triple(92005L, 132L, 6.0),
            Triple(92306L, 230L, 7.4),
            Triple(92737L, 1027L, 10.8),
            Triple(93915L, 1097L, 21.0),
            Triple(95269L, 0L, 3.3),
            Triple(99402L, 232L, 60.8),
            Triple(105397L, 130L, 54.5),
            Triple(109096L, 196L, 42.7),
            Triple(121521L, 162L, 53.8),
            Triple(131744L, 167L, 54.1),
            Triple(139406L, 1431L, 51.2),
            Triple(141081L, 1291L, 16.7),
            Triple(142638L, 1235L, 24.8),
        )
        pruefe(nachgebaut(stoesse),
            listOf(45_972L, 49_529, 54_363, 58_857, 74_149, 99_402, 105_397, 109_096, 121_521, 131_744), listOf(11_322L))
    }
}
