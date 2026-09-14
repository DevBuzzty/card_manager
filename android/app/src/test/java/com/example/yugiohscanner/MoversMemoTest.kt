package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.PriceRef
import com.example.yugiohscanner.ui.MoversMemo
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

/** Spec G1 §4.3: Bewegungen nach Identitaet gemerkt -- wie DashboardMemoTest. */
class MoversMemoTest {
    private val cards = listOf(CardRow("1", "A-DE001", "DE", "A", null, "Common", 1, 3.0, priceLocked = 1))
    private val copies = listOf(CopyRow("c1", "1", "A-DE001", "DE", "Common", "unknown", "NM", false,
        containerId = null, page = null, slot = null, tags = null, note = null))
    private val refs = listOf(PriceRef("1", "A-DE001", "DE", "Common", "2026-09-01", 2.0, "cm_bulk"))

    @Test fun `gleiche Referenzen und gleicher Tag liefern dieselbe Instanz`() {
        val a = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertSame(a, MoversMemo.get(cards, copies, refs, "2026-09-20", 7))
        assertSame(a, MoversMemo.peek(cards, copies, refs, "2026-09-20", 7))
    }

    @Test fun `neue Referenzliste, neuer Tag oder anderes Fenster rechnet neu`() {
        val a = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertNotSame(a, MoversMemo.get(cards, copies, refs.toList(), "2026-09-20", 7))
        val b = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertNotSame(b, MoversMemo.get(cards, copies, refs, "2026-09-21", 7))
        val c = MoversMemo.get(cards, copies, refs, "2026-09-21", 7)
        val d = MoversMemo.get(cards, copies, refs, "2026-09-21", 30)
        assertSame(c, MoversMemo.get(cards, copies, refs, "2026-09-21", 7))
        assertSame(d, MoversMemo.get(cards, copies, refs, "2026-09-21", 30))
    }
}
