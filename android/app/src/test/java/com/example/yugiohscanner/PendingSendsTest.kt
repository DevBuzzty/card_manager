package com.example.yugiohscanner

import com.example.yugiohscanner.ml.PendingSends
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingSendsTest {

    @Test fun `wartet ohne Set-Code, sendet sobald einer da ist`() {
        val p = PendingSends()
        p.add(7, 1, 1_000)
        assertTrue(p.due(1_300) { false }.isEmpty())
        assertEquals(listOf(7 to 1), p.due(1_400) { it == 7 })
        assertTrue(p.due(5_000) { true }.isEmpty())
    }

    @Test fun `sendet nach Ablauf der Wartezeit auch ohne Set-Code`() {
        val p = PendingSends(maxWaitMs = 1_500)
        p.add(7, 1, 0)
        assertTrue(p.due(1_499) { false }.isEmpty())
        assertEquals(listOf(7 to 1), p.due(1_500) { false })
    }

    @Test fun `mehrere Einwuerfe derselben Karte werden zusammengefasst, Wartezeit ab dem ersten`() {
        val p = PendingSends(maxWaitMs = 1_500)
        p.add(7, 1, 0)
        p.add(7, 2, 1_000)
        assertEquals(listOf(7 to 3), p.due(1_500) { false })
    }

    @Test fun `flushAll gibt alles sofort heraus`() {
        val p = PendingSends()
        p.add(7, 1, 0); p.add(9, 1, 0)
        assertEquals(listOf(7 to 1, 9 to 1), p.flushAll())
        assertTrue(p.due(10_000) { true }.isEmpty())
    }
}
