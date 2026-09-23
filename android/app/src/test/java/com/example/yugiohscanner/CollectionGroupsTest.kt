package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ui.CollectionGroupsMemo
import com.example.yugiohscanner.ui.GroupFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Performance: Gruppieren/Filtern der Kartenliste abseits der Komposition, gemerkt je Speicherstand und Filter. */
class CollectionGroupsTest {
    private fun card(id: String, set: String, name: String, price: Double, rarity: String = "Common") =
        CardRow(id, set, "DE", name, null, rarity, 1, price)

    private fun copy(cardId: String, set: String, rarity: String = "Common", note: String? = null, container: String? = null) = CopyRow(
        "copy-$cardId-$set-${System.nanoTime()}", cardId, set, "DE", rarity, "unknown", "NM", false,
        containerId = container, page = null, slot = null, tags = null, note = note,
    )

    private val cards = listOf(
        card("1", "LOB-DE001", "Blauäugiger w. Drache", 5.0),
        card("1", "SDK-DE001", "Blauäugiger w. Drache", 9.0, "Ultra Rare"),
        card("2", "MRD-DE002", "Schwarzer Magier", 3.0),
    )
    private val copies = listOf(
        copy("1", "LOB-DE001"), copy("1", "SDK-DE001", "Ultra Rare"),
        copy("2", "MRD-DE002", note = "Geschenk von Opa"),
    )
    private val containers = emptyList<ContainerRow>()

    @Test fun `gruppiert je Passcode, Druecke nach Preis absteigend`() {
        val g = CollectionGroupsMemo.get(cards, copies, containers, GroupFilter(sort = "name"))
        assertEquals(listOf("1", "2"), g.map { it.id })
        assertEquals(listOf("SDK-DE001", "LOB-DE001"), g[0].variants.map { it.setCode })
        assertEquals(2, g[0].totalQty)
    }

    @Test fun `Suche findet auch Notizen der Exemplare`() {
        val g = CollectionGroupsMemo.get(cards, copies, containers, GroupFilter(query = "opa"))
        assertEquals(listOf("2"), g.map { it.id })
    }

    @Test fun `Rarity-Filter und Sortierung nach Einzelpreis`() {
        assertEquals(listOf("1"), CollectionGroupsMemo.get(cards, copies, containers, GroupFilter(rarity = "Ultra Rare")).map { it.id })
        assertEquals(listOf("1", "2"), CollectionGroupsMemo.get(cards, copies, containers, GroupFilter(sort = "single")).map { it.id })
    }

    @Test fun `gleicher Stand und gleicher Filter liefern dieselbe Instanz`() {
        val f = GroupFilter(sort = "total")
        val first = CollectionGroupsMemo.get(cards, copies, containers, f)
        assertSame(first, CollectionGroupsMemo.peek(cards, copies, containers, f.copy()))
        assertSame(first, CollectionGroupsMemo.get(cards, copies, containers, f.copy()))
    }

    @Test fun `anderer Filter nutzt dieselbe Basis, neuer Stand baut sie neu`() {
        CollectionGroupsMemo.get(cards, copies, containers, GroupFilter())
        val base = CollectionGroupsMemo.peekBase(cards, copies, containers)
        CollectionGroupsMemo.get(cards, copies, containers, GroupFilter(query = "magier"))
        assertSame(base, CollectionGroupsMemo.peekBase(cards, copies, containers))

        val newCopies = copies.toList()
        assertNull(CollectionGroupsMemo.peek(cards, newCopies, containers, GroupFilter()))
        CollectionGroupsMemo.get(cards, newCopies, containers, GroupFilter())
        assertNotSame(base, CollectionGroupsMemo.peekBase(cards, newCopies, containers))
    }

    @Test fun `Filteroptionen kommen aus der Basis`() {
        CollectionGroupsMemo.get(cards, copies, containers, GroupFilter())
        val base = CollectionGroupsMemo.peekBase(cards, copies, containers)!!
        assertEquals(listOf("LOB", "MRD", "SDK"), base.setOptions)
        assertEquals(listOf("Common", "Ultra Rare"), base.rarityOptions)
    }
}
