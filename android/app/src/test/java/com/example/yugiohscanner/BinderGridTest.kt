package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.BinderGrid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Spec B2 §7.2: die reinen Rechnungen der Binder-Ansicht. Die Ansicht selbst laesst sich ohne
// Geraet nicht pruefen -- diese Rechnungen schon, und sie sind es, an denen die Spec haengt
// (Seitenzahl aus der hoechsten BELEGTEN Seite, mehrfach belegte Faecher, Faecher jenseits der
// Ordnergroesse).
class BinderGridTest {

    private fun copy(
        copyId: String,
        page: Int? = null,
        slot: Int? = null,
        setCode: String = "LOB-DE001",
        cardId: String = "12345678",
        tags: String? = null,
        note: String? = null,
    ) = CopyRow(
        copyId = copyId, cardId = cardId, setCode = setCode, language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = false,
        containerId = "b1", page = page, slot = slot, tags = tags, note = note,
    )

    // --- columns ---

    @Test fun `vier Faecher ergeben zwei Spalten`() = assertEquals(2, BinderGrid.columns(4))
    @Test fun `neun Faecher ergeben drei Spalten`() = assertEquals(3, BinderGrid.columns(9))
    @Test fun `zwoelf Faecher ergeben drei Spalten`() = assertEquals(3, BinderGrid.columns(12))

    @Test fun `unsinnige Fachzahl faellt auf den 4er-Ordner zurueck`() {
        // SlotMath.clampPockets zieht 0 auf 4 -- BinderGrid baut die Regel nicht nach.
        assertEquals(2, BinderGrid.columns(0))
        assertEquals(2, BinderGrid.columns(-3))
    }

    // --- isPlaced / loose ---

    @Test fun `Exemplar ohne Seite oder Fach ist nicht einsortiert`() {
        assertFalse(BinderGrid.isPlaced(copy("c1"), 9))
        assertFalse(BinderGrid.isPlaced(copy("c2", page = 2), 9))
        assertFalse(BinderGrid.isPlaced(copy("c3", slot = 5), 9))
    }

    @Test fun `Fach jenseits der Ordnergroesse gilt nicht als einsortiert`() {
        // Rest einer frueheren, groesseren Seitengroesse: Fach 12 gibt es im 9er-Ordner nicht.
        assertFalse(BinderGrid.isPlaced(copy("c1", page = 1, slot = 12), 9))
        assertTrue(BinderGrid.isPlaced(copy("c2", page = 1, slot = 9), 9))
    }

    @Test fun `loose sammelt genau die nicht darstellbaren Exemplare`() {
        val copies = listOf(
            copy("drin", page = 1, slot = 1),
            copy("ohneFach"),
            copy("zuHohesFach", page = 1, slot = 12),
        )
        assertEquals(listOf("ohneFach", "zuHohesFach"), BinderGrid.loose(copies, 9).map { it.copyId })
    }

    // --- pageCount ---

    @Test fun `leerer Ordner hat trotzdem eine Seite`() {
        assertEquals(1, BinderGrid.pageCount(emptyList(), 9))
        assertEquals(1, BinderGrid.pageCount(listOf(copy("c1")), 9))
    }

    @Test fun `Seitenzahl ist die hoechste belegte Seite, nicht ceil Anzahl durch Faecher`() {
        // Ein einziges Exemplar auf Seite 7: ceil(1/9) waere 1 -- falsch.
        assertEquals(7, BinderGrid.pageCount(listOf(copy("c1", page = 7, slot = 3)), 9))
    }

    @Test fun `zehn Exemplare auf Seite eins ergeben trotzdem eine Seite`() {
        // ceil(10/9) waere 2; belegt ist aber nur Seite 1 (zwei Exemplare teilen sich ein Fach).
        val copies = (1..10).map { copy("c$it", page = 1, slot = if (it > 9) 9 else it) }
        assertEquals(1, BinderGrid.pageCount(copies, 9))
    }

    @Test fun `eine Seite, auf der nur zu hohe Faecher liegen, zaehlt nicht`() {
        val copies = listOf(copy("c1", page = 1, slot = 1), copy("c2", page = 4, slot = 12))
        assertEquals(1, BinderGrid.pageCount(copies, 9))
    }

    // --- slots ---

    @Test fun `slots liefert immer genau so viele Faecher wie die Seite gross ist`() {
        assertEquals(4, BinderGrid.slots(emptyList(), 1, 4).size)
        assertEquals(9, BinderGrid.slots(emptyList(), 1, 9).size)
        assertEquals(12, BinderGrid.slots(emptyList(), 1, 12).size)
    }

    @Test fun `slots ordnet jedes Exemplar seinem Fach zu, Fach eins steht an Position null`() {
        val copies = listOf(copy("c1", page = 1, slot = 1), copy("c3", page = 1, slot = 3))
        val page = BinderGrid.slots(copies, 1, 4)
        assertEquals(listOf("c1"), page[0].map { it.copyId })
        assertEquals(emptyList<String>(), page[1].map { it.copyId })
        assertEquals(listOf("c3"), page[2].map { it.copyId })
        assertEquals(emptyList<String>(), page[3].map { it.copyId })
    }

    @Test fun `mehrere Exemplare im selben Fach bleiben zusammen und in Eingabereihenfolge`() {
        val copies = listOf(
            copy("erst", page = 2, slot = 5),
            copy("dann", page = 2, slot = 5),
            copy("andereSeite", page = 3, slot = 5),
        )
        val page = BinderGrid.slots(copies, 2, 9)
        assertEquals(listOf("erst", "dann"), page[4].map { it.copyId })
    }

    @Test fun `slots zeigt nur die verlangte Seite`() {
        val copies = listOf(copy("s1", page = 1, slot = 1), copy("s2", page = 2, slot = 1))
        assertEquals(listOf("s2"), BinderGrid.slots(copies, 2, 9)[0].map { it.copyId })
    }

    @Test fun `slots laesst ein Fach jenseits der Ordnergroesse weg`() {
        val copies = listOf(copy("zuHoch", page = 1, slot = 12))
        assertTrue(BinderGrid.slots(copies, 1, 9).all { it.isEmpty() })
    }

    // --- filterCandidates ---

    private val named = mapOf("a" to "Blauäugiger Weißer Drache", "b" to "Dunkler Magier")
    private fun nameOf(c: CopyRow): String? = named[c.copyId]

    @Test fun `leere Suche liefert alles`() {
        val copies = listOf(copy("a"), copy("b"))
        assertEquals(2, BinderGrid.filterCandidates(copies, "   ", ::nameOf).size)
    }

    @Test fun `Suche trifft Name, Set-Code, Passcode, Tag und Notiz`() {
        val copies = listOf(
            copy("a"),
            copy("b", setCode = "SDK-DE042"),
            copy("c", cardId = "89631139"),
            copy("d", tags = """["Handelsstapel"]"""),
            copy("e", note = "geknickte Ecke"),
        )
        fun ids(q: String) = BinderGrid.filterCandidates(copies, q, ::nameOf).map { it.copyId }
        assertEquals(listOf("a"), ids("weißer"))          // Name, Gross-/Kleinschreibung egal
        assertEquals(listOf("b"), ids("SDK-DE042"))        // Set-Code
        assertEquals(listOf("c"), ids("89631139"))         // Passcode
        assertEquals(listOf("d"), ids("handelsstapel"))    // Tag
        assertEquals(listOf("e"), ids("knick"))            // Notiz
    }

    @Test fun `Suche ohne Treffer liefert nichts`() {
        assertEquals(emptyList<CopyRow>(), BinderGrid.filterCandidates(listOf(copy("a")), "Exodia", ::nameOf))
    }
}
