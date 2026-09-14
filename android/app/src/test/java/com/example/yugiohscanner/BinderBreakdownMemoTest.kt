package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ui.BinderBreakdownMemo
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Spec G1 §4.7 -- `BinderBreakdownMemo` rechnet nur neu, wenn `cards`/`copies`/`containers` als Referenz wechseln. */
class BinderBreakdownMemoTest {
    private fun card(id: String) = CardRow(id, "LOB-DE001", "DE", "Karte $id", null, "Common", 1, 1.0)

    private fun copy(cardId: String) = CopyRow(
        "copy-$cardId-${System.nanoTime()}", cardId, "LOB-DE001", "DE", "Common", "unknown", "NM", false,
        containerId = null, page = null, slot = null, tags = null, note = null,
    )

    private fun container(id: String) = ContainerRow(id, "Ordner $id", "binder", 9, null, 0)

    @Test fun `gleiche Referenzen liefern dieselbe Ergebnisinstanz`() {
        val cards = listOf(card("1"))
        val copies = listOf(copy("1"))
        val containers = listOf(container("1"))
        val first = BinderBreakdownMemo.get(cards, copies, containers)
        val second = BinderBreakdownMemo.get(cards, copies, containers)
        assertSame(first, second)
        assertSame(first, BinderBreakdownMemo.peek(cards, copies, containers))
    }

    @Test fun `neue Listeninstanz wird neu gerechnet`() {
        val cards = listOf(card("2"))
        val copies = listOf(copy("2"))
        val containers = listOf(container("2"))
        val first = BinderBreakdownMemo.get(cards, copies, containers)
        val second = BinderBreakdownMemo.get(cards, copies, containers.toList())
        assertNotSame(first, second)
        assertNull(BinderBreakdownMemo.peek(cards.toList(), copies, containers))
    }
}
