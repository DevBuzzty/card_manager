package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.BinderBreakdown
import com.example.yugiohscanner.ml.ValueGroup
import org.junit.Assert.assertEquals
import org.junit.Test

class BinderBreakdownTest {
    private fun copy(id: String, card: String, cond: String, container: String?, deleted: Boolean = false) =
        CopyRow(id, card, "S-DE00$card", "DE", "Common", "unknown", cond, deleted,
            containerId = container, page = null, slot = null, tags = null, note = null)

    @Test fun `Wert je Behaelter, Nicht einsortiert fuer ohne, unbekannt oder geloescht`() {
        val cards = listOf(
            CardRow("1", "S-DE001", "DE", "A", null, "Common", 2, 10.0),
            CardRow("2", "S-DE002", "DE", "B", null, "Common", 1, 4.0),
        )
        val copies = listOf(
            copy("a", "1", "NM", "b1"),
            copy("b", "1", "EX", null),
            copy("c", "2", "NM", "weg"),
            copy("d", "2", "NM", "alt"),
            copy("e", "2", "NM", "b1", deleted = true),
        )
        val containers = listOf(
            ContainerRow("b1", "Ordner Blau", "binder", 9, null, 0),
            ContainerRow("alt", "Alte Box", "box", null, null, 1, deleted = true),
        )
        assertEquals(
            listOf(ValueGroup(BinderBreakdown.UNSORTED, 3, 16.5), ValueGroup("Ordner Blau", 1, 10.0)),
            BinderBreakdown.compute(cards, copies, containers),
        )
    }
}
