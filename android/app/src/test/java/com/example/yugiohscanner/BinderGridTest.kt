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

    // --- maxPlacedPage ---
    //
    // Abschluss-Fixwelle, Minor 3: die Zahl, die die BEHAELTERLISTE zeigt ("7 Seiten"). Sie muss
    // dieselbe Regel treffen wie das aufgeschlagene Raster, sonst verspricht die Liste Seiten, die
    // es aufgeschlagen nicht gibt. Unterschied zu `pageCount` ist allein die leere Antwort: hier
    // null, dort 1 -- die Liste setzt dieselbe 1 selbst ein (BindersScreen: `maxPage ?: 1`). Einen
    // ceil(Anzahl/Faecher)-Rueckfall gibt es nicht mehr, auf keinem der beiden Geraete.

    @Test fun `ohne einsortiertes Exemplar gibt es keine hoechste Seite`() {
        assertEquals(null, BinderGrid.maxPlacedPage(emptyList(), 9))
        assertEquals(null, BinderGrid.maxPlacedPage(listOf(copy("c1")), 9))
    }

    @Test fun `hoechste Seite ist die hoechste belegte`() {
        val copies = listOf(copy("c1", page = 1, slot = 1), copy("c2", page = 7, slot = 3))
        assertEquals(7, BinderGrid.maxPlacedPage(copies, 9))
    }

    @Test fun `Fach jenseits der Ordnergroesse zaehlt fuer die hoechste Seite nicht`() {
        // Der Ordner wurde von 12 auf 9 Faecher umgestellt; S7/F11 kann kein Raster zeigen.
        // Ein blosses MAX ueber `page` saehe hier 7 -- die Liste sagte "7 Seiten", aufgeschlagen
        // stuende "Seite 1 von 3".
        val copies = listOf(copy("c1", page = 3, slot = 9), copy("c2", page = 7, slot = 11))
        assertEquals(3, BinderGrid.maxPlacedPage(copies, 9))
    }

    @Test fun `hoechste Seite und Seitenzahl treffen dieselbe Regel`() {
        val copies = listOf(
            copy("c1", page = 2, slot = 4),
            copy("ohneFach"),
            copy("zuHohesFach", page = 8, slot = 12),
        )
        assertEquals(BinderGrid.pageCount(copies, 9), BinderGrid.maxPlacedPage(copies, 9))
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

    // Die Ansicht leitet die Seitenzahl aus DERSELBEN Liste und DERSELBEN Fachzahl ab, aus denen
    // sie auch die Faecher baut (frueher war es ein mitgefuehrter zweiter Zustand aus einer
    // zweiten Filterung). Diese Pruefung haelt beide Rechnungen aneinander: die letzte gezaehlte
    // Seite zeigt wirklich etwas, und die Seite dahinter ist leer.
    @Test fun `die letzte gezaehlte Seite ist belegt, die naechste nicht`() {
        val copies = listOf(
            copy("c1", page = 1, slot = 1),
            copy("c2", page = 3, slot = 5),
            copy("ohneFach"),
            copy("zuHohesFach", page = 9, slot = 12),
        )
        val last = BinderGrid.pageCount(copies, 9)
        assertEquals(3, last)
        assertTrue(BinderGrid.slots(copies, last, 9).any { it.isNotEmpty() })
        assertTrue(BinderGrid.slots(copies, last + 1, 9).all { it.isEmpty() })
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

    // --- candidateGroups ---
    //
    // "Aus Fach nehmen" raeumt nur Seite und Fach, nicht den Behaelter. Damit das keine Sackgasse
    // ist, muss das Auswahlangebot eines leeren Fachs die Exemplare DIESES Ordners ohne Fach
    // mitanbieten -- als eigene, voranstehende Gruppe neben den Exemplaren ohne Behaelter.

    @Test fun `Auswahlangebot bietet zuerst den eigenen Ordner, dann die nicht einsortierten`() {
        val loose = BinderGrid.loose(listOf(copy("drin", page = 1, slot = 1), copy("ausgefacht")), 9)
        val unsorted = listOf(copy("frei"))
        val groups = BinderGrid.candidateGroups(loose, unsorted, "", ::nameOf)
        assertEquals(listOf("ausgefacht"), groups.inContainer.map { it.copyId })
        assertEquals(listOf("frei"), groups.unsorted.map { it.copyId })
        assertFalse(groups.isEmpty())
    }

    @Test fun `ein aus dem Fach genommenes Exemplar bleibt einlegbar`() {
        // Genau der Zustand nach "Aus Fach nehmen": Behaelter noch da, Seite und Fach leer. Vorher
        // war er eine Sackgasse -- weder im Raster noch im Auswahlangebot.
        val ausgefacht = copy("c1", page = null, slot = null)
        val groups = BinderGrid.candidateGroups(BinderGrid.loose(listOf(ausgefacht), 9), emptyList(), "", ::nameOf)
        assertEquals(listOf("c1"), groups.inContainer.map { it.copyId })
    }

    @Test fun `die Suche wirkt auf beide Gruppen`() {
        val loose = listOf(copy("a"), copy("b"))                       // "Blauaeugiger..." und "Dunkler Magier"
        val unsorted = listOf(copy("x", setCode = "SDK-DE042"), copy("y", note = "Blau geknickt"))
        val groups = BinderGrid.candidateGroups(loose, unsorted, "blau", ::nameOf)
        assertEquals(listOf("a"), groups.inContainer.map { it.copyId })
        assertEquals(listOf("y"), groups.unsorted.map { it.copyId })
    }

    @Test fun `ohne Kandidaten sind beide Gruppen leer`() {
        assertTrue(BinderGrid.candidateGroups(emptyList(), emptyList(), "", ::nameOf).isEmpty())
        assertTrue(BinderGrid.candidateGroups(listOf(copy("a")), listOf(copy("b")), "Exodia", ::nameOf).isEmpty())
    }
}
