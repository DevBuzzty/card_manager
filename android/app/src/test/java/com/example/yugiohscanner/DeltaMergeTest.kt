package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.DeltaMerge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** Einarbeiten geaenderter Zeilen in den Speicher (Spec §4.2). */
class DeltaMergeTest {

    private fun copy(id: String, deleted: Boolean = false, note: String? = null) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = null, note = note, updatedAt = "2026-09-13T12:00:00Z",
    )

    private fun card(id: String, setCode: String = "LOB-DE001", qty: Int = 1, deleted: Boolean = false, rarity: String = "Common") =
        CardRow(id = id, setCode = setCode, language = "DE", name = "n", imageUrl = null, rarity = rarity,
            quantity = qty, price = 1.0, deleted = deleted)

    private fun container(id: String, sort: Int, deleted: Boolean = false) =
        ContainerRow(containerId = id, name = id, kind = "box", pocketsPerPage = null, color = null, sortOrder = sort, deleted = deleted)

    @Test fun `neue Zeile wird einsortiert`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("c")), listOf(copy("b")))
        assertEquals(listOf("a", "b", "c"), out.map { it.copyId })
    }

    @Test fun `geaenderte Zeile ersetzt die alte`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("b")), listOf(copy("b", note = "neu")))
        assertEquals("neu", out.first { it.copyId == "b" }.note)
        assertEquals(2, out.size)
    }

    @Test fun `geloeschte Zeile verschwindet`() {
        val out = DeltaMerge.copies(listOf(copy("a"), copy("b")), listOf(copy("a", deleted = true)))
        assertEquals(listOf("b"), out.map { it.copyId })
    }

    @Test fun `geloeschte unbekannte Zeile aendert nichts`() {
        val current = listOf(copy("a"))
        assertSame(current, DeltaMerge.copies(current, listOf(copy("x", deleted = true))))
    }

    @Test fun `Karte mit Menge null verschwindet wie eine geloeschte`() {
        val out = DeltaMerge.cards(listOf(card("1"), card("2")), listOf(card("1", qty = 0), card("2", deleted = true)))
        assertEquals(emptyList<CardRow>(), out)
    }

    @Test fun `unveraenderte Lieferung liefert dieselbe Liste zurueck`() {
        val current = listOf(copy("a"), copy("b"))
        assertSame(current, DeltaMerge.copies(current, listOf(copy("a"), copy("b"))))
    }

    @Test fun `leere Lieferung liefert dieselbe Liste zurueck`() {
        val current = listOf(copy("a"))
        assertSame(current, DeltaMerge.copies(current, emptyList()))
    }

    @Test fun `Karten nach Passcode, Set-Code, Sprache, Seltenheit`() {
        val out = DeltaMerge.cards(emptyList(), listOf(
            card("2"), card("1", setCode = "SDK-DE001"), card("1", rarity = "Ultra Rare"), card("1"),
        ))
        assertEquals(
            listOf("1|LOB-DE001|Common", "1|LOB-DE001|Ultra Rare", "1|SDK-DE001|Common", "2|LOB-DE001|Common"),
            out.map { "${it.id}|${it.setCode}|${it.rarity}" },
        )
    }

    @Test fun `Behaelter nach sort_order, dann container_id`() {
        val out = DeltaMerge.containers(emptyList(), listOf(container("b", 1), container("a", 1), container("z", 0)))
        assertEquals(listOf("z", "a", "b"), out.map { it.containerId })
    }

    @Test fun `vollstaendiges Laden ist Einarbeiten in eine leere Liste`() {
        val out = DeltaMerge.containers(emptyList(), listOf(container("a", 0), container("weg", 0, deleted = true)))
        assertEquals(listOf("a"), out.map { it.containerId })
    }
}
