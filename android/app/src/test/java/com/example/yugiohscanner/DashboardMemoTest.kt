package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ui.DashboardMemo
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

/** Befund A: `DashboardMemo` rechnet nur neu, wenn `cards`/`copies` als Referenz wechseln. */
class DashboardMemoTest {
    private fun card(id: String) = CardRow(id, "LOB-DE001", "DE", "Karte $id", null, "Common", 1, 1.0)

    private fun copy(cardId: String) = CopyRow(
        "copy-$cardId-${System.nanoTime()}", cardId, "LOB-DE001", "DE", "Common", "unknown", "NM", false,
        containerId = null, page = null, slot = null, tags = null, note = null,
    )

    @Test fun `gleiche Referenzen liefern dieselbe Ergebnisinstanz`() {
        val cards = listOf(card("1"))
        val copies = listOf(copy("1"))
        val first = DashboardMemo.get(cards, copies)
        val second = DashboardMemo.get(cards, copies)
        assertSame(first, second)
    }

    @Test fun `neue Listeninstanz wird neu gerechnet`() {
        val cards = listOf(card("2"))
        val copies = listOf(copy("2"))
        val first = DashboardMemo.get(cards, copies)
        val second = DashboardMemo.get(cards.toList(), copies.toList())
        assertNotSame(first, second)
    }

    @Test fun `inhaltlich gleiche aber neue Liste wird neu gerechnet`() {
        val copies = listOf(copy("3"))
        val cardsA = listOf(card("3"))
        val cardsB = listOf(card("3")) // == cardsA per Inhalt, aber eine andere Listeninstanz
        val first = DashboardMemo.get(cardsA, copies)
        val second = DashboardMemo.get(cardsB, copies)
        assertNotSame(first, second)
    }
}
