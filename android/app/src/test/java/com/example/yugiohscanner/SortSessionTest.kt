package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.PendingWrite
import com.example.yugiohscanner.ml.Placement
import com.example.yugiohscanner.ml.Ruecknahme
import com.example.yugiohscanner.ml.Schritt
import com.example.yugiohscanner.ml.SortSession
import com.example.yugiohscanner.ml.SortState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

// Spec B2 §6: die reinen Rechnungen des Einsortier-Modus. Die Kamera-Oberflaeche laesst sich ohne
// Geraet nicht pruefen -- der Startvorschlag, das Vorruecken ueber mehrere Karten, der
// Rueckgaengig-Stapel und die Warteschlange schon, und genau an ihnen haengt die Spec.
class SortSessionTest {

    private fun copy(
        copyId: String,
        cardId: String = "12345678",
        containerId: String? = null,
        page: Int? = null,
        slot: Int? = null,
    ) = CopyRow(
        copyId = copyId, cardId = cardId, setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = false,
        containerId = containerId, page = page, slot = slot, tags = null, note = null,
    )

    /** Das [Placement] eines Schrittes -- die Tests unten pruefen fast immer eine Zuweisung. */
    private fun zugewiesen(schritt: Schritt) = (schritt as Schritt.Zugewiesen).placement

    /** Dasselbe fuer eine Ruecknahme. */
    private fun genommen(r: Ruecknahme) = (r as Ruecknahme.Zuweisung).placement

    // --- Startvorschlag ---

    @Test fun `leerer Ordner startet auf Seite 1 Fach 1`() {
        val s = SortSession.start(listOf(copy("c1")), "b1", 9)
        assertEquals(1, s.page)
        assertEquals(1, s.slot)
        assertTrue(s.schritte.isEmpty())
    }

    @Test fun `Startvorschlag ist das erste freie Fach dieses Behaelters`() {
        val copies = listOf(
            copy("c1", containerId = "b1", page = 1, slot = 1),
            copy("c2", containerId = "b1", page = 1, slot = 2),
            copy("c3", containerId = "b1", page = 1, slot = 4),
        )
        val s = SortSession.start(copies, "b1", 9)
        assertEquals(1, s.page)
        assertEquals(3, s.slot)
    }

    @Test fun `Exemplare fremder Behaelter zaehlen nicht als belegt`() {
        val copies = listOf(
            copy("fremd", containerId = "b2", page = 1, slot = 1),
            copy("frei"),
        )
        val s = SortSession.start(copies, "b1", 9)
        assertEquals(1, s.page)
        assertEquals(1, s.slot)
    }

    @Test fun `ein Fach jenseits der Ordnergroesse gilt nicht als belegt`() {
        // Gleiche Regel wie BinderGrid.isPlaced/SlotMath.firstFree: Rest einer frueheren,
        // groesseren Seitengroesse. Hier NICHT nachgebaut, sondern uebernommen.
        val copies = listOf(copy("c1", containerId = "b1", page = 1, slot = 12))
        val s = SortSession.start(copies, "b1", 9)
        assertEquals(1, s.page)
        assertEquals(1, s.slot)
    }

    @Test fun `volle erste Seite fuehrt auf Seite 2`() {
        val copies = (1..4).map { copy("c$it", containerId = "b1", page = 1, slot = it) }
        val s = SortSession.start(copies, "b1", 4)
        assertEquals(2, s.page)
        assertEquals(1, s.slot)
    }

    // --- Startpunkt von Hand ---

    @Test fun `Eingaben unter 1 werden hochgezogen`() {
        assertEquals(1 to 1, SortSession.startAt(0, 0, 9))
        assertEquals(1 to 1, SortSession.startAt(-5, -5, 9))
    }

    @Test fun `ein Fach jenseits der Seitengroesse wird auf das letzte gezogen`() {
        assertEquals(3 to 9, SortSession.startAt(3, 99, 9))
        assertEquals(1 to 4, SortSession.startAt(1, 12, 4))
    }

    @Test fun `unsinnige Fachzahl faellt auf den 4er-Ordner zurueck`() {
        assertEquals(1 to 4, SortSession.startAt(1, 9, 0))
    }

    @Test fun `ein Vertipper bei der Seite wird auf die letzte Seite gezogen`() {
        // "9999" statt "999": ohne Obergrenze saesse die naechste Karte auf Seite 9999 und die
        // Binder-Ansicht baute einen Pager ueber 9999 Seiten.
        assertEquals(999 to 1, SortSession.startAt(9999, 1, 9))
        assertEquals(999 to 9, SortSession.startAt(SortSession.MAX_PAGE, 9, 9))
        assertEquals(998 to 1, SortSession.startAt(998, 1, 9))
    }

    // --- Zuweisen und Vorruecken ---

    @Test fun `Zuweisen rueckt vor und merkt sich den vorherigen Standort`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 9)
        val (next, placement) = SortSession.assign(start, "c1", "b1", 9)!!
        assertEquals(1, placement.page)
        assertEquals(1, placement.slot)
        assertNull(placement.vorherContainerId)
        assertEquals(1, next.page)
        assertEquals(2, next.slot)
        assertSame(placement, zugewiesen(next.schritte.single()))
    }

    @Test fun `die Arbeitskopie traegt den neuen Standort mit`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 9)
        val (next, _) = SortSession.assign(start, "c1", "b1", 9)!!
        val c = next.copies.first { it.copyId == "c1" }
        assertEquals("b1", c.containerId)
        assertEquals(1, c.page)
        assertEquals(1, c.slot)
        // Der Ausgangszustand bleibt unberuehrt -- SortState ist ein Wert, kein gemeinsamer Topf.
        assertNull(start.copies.first { it.copyId == "c1" }.containerId)
    }

    @Test fun `mehrere Karten hintereinander blaettern die Seite um`() {
        var state = SortSession.start((1..5).map { copy("c$it") }, "b1", 4)
        val faecher = ArrayList<Pair<Int, Int>>()
        for (i in 1..5) {
            val (next, p) = SortSession.assign(state, "c$i", "b1", 4)!!
            faecher.add(p.page to p.slot)
            state = next
        }
        assertEquals(
            listOf(1 to 1, 1 to 2, 1 to 3, 1 to 4, 2 to 1),
            faecher,
        )
        assertEquals(2 to 2, state.page to state.slot)
    }

    @Test fun `Zuweisen eines unbekannten Exemplars liefert null statt zu werfen`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 9)
        assertNull(SortSession.assign(start, "gibtsNicht", "b1", 9))
    }

    @Test fun `ein bereits einsortiertes Exemplar behaelt seinen alten Standort als vorher`() {
        // Der Fall aus Task 7 (AllPlaced -> eines hierher verschieben): die Ruecknahme darf nicht
        // annehmen, dass "vorher" immer leer ist.
        val start = SortSession.start(listOf(copy("c1", containerId = "b2", page = 3, slot = 7)), "b1", 9)
        val (_, p) = SortSession.assign(start, "c1", "b1", 9)!!
        assertEquals("b2", p.vorherContainerId)
        assertEquals(3, p.vorherPage)
        assertEquals(7, p.vorherSlot)
    }

    // --- Rueckgaengig ---

    @Test fun `Rueckgaengig auf leerem Stapel liefert null`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 9)
        assertNull(SortSession.undo(start))
    }

    @Test fun `Rueckgaengig setzt Standort und Fach zurueck`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 9)
        val (nachZuweisung, placement) = SortSession.assign(start, "c1", "b1", 9)!!
        val (zurueck, zurueckgenommen) = SortSession.undo(nachZuweisung)!!
        assertSame(placement, genommen(zurueckgenommen))
        assertEquals(1, zurueck.page)
        assertEquals(1, zurueck.slot)
        assertTrue(zurueck.schritte.isEmpty())
        val c = zurueck.copies.first { it.copyId == "c1" }
        assertNull(c.containerId)
        assertNull(c.page)
        assertNull(c.slot)
    }

    @Test fun `Rueckgaengig ueber einen Seitenumbruch hinweg springt auf die alte Seite`() {
        var state = SortSession.start((1..5).map { copy("c$it") }, "b1", 4)
        repeat(5) { i -> state = SortSession.assign(state, "c${i + 1}", "b1", 4)!!.first }
        assertEquals(2 to 2, state.page to state.slot)
        val (zurueck, p) = SortSession.undo(state)!!
        assertEquals(2 to 1, zurueck.page to zurueck.slot)   // die fuenfte Karte lag auf Seite 2, Fach 1
        assertEquals("c5", genommen(p).copyId)
        val (nochmal, p4) = SortSession.undo(zurueck)!!
        assertEquals(1 to 4, nochmal.page to nochmal.slot)
        assertEquals("c4", genommen(p4).copyId)
    }

    @Test fun `Rueckgaengig trifft die zuletzt zugewiesene Karte auch bei gleichem Passcode`() {
        // Zwei Exemplare DERSELBEN Karte hintereinander -- ueber Positionen oder Inhalte waere
        // hier nicht zu unterscheiden, welches gemeint ist (D4: ein aufgehobener Index hat die
        // falsche Karte heruntergezaehlt).
        var state = SortSession.start(listOf(copy("c1"), copy("c2")), "b1", 9)
        val (s1, erste) = SortSession.assign(state, "c1", "b1", 9)!!
        val (s2, zweite) = SortSession.assign(s1, "c2", "b1", 9)!!
        state = s2
        val (zurueck, zurueckgenommen) = SortSession.undo(state)!!
        assertSame(zweite, genommen(zurueckgenommen))
        assertNull(zurueck.copies.first { it.copyId == "c2" }.containerId)
        assertEquals("b1", zurueck.copies.first { it.copyId == "c1" }.containerId)
        assertSame(erste, zugewiesen(zurueck.schritte.single()))
    }

    @Test fun `die ganze Sitzung laesst sich zurueckdrehen`() {
        var state = SortSession.start((1..3).map { copy("c$it") }, "b1", 9)
        repeat(3) { i -> state = SortSession.assign(state, "c${i + 1}", "b1", 9)!!.first }
        repeat(3) { state = SortSession.undo(state)!!.first }
        assertEquals(1 to 1, state.page to state.slot)
        assertTrue(state.copies.all { it.containerId == null })
        assertNull(SortSession.undo(state))
    }

    // --- Reservieren (Task 7: die Karte ist nicht in der Sammlung) ---

    @Test fun `Reservieren rueckt vor, ohne die Arbeitskopie anzufassen`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 4)
        val marke = Any()
        val (next, schritt) = SortSession.reserve(start, 4, marke)
        assertEquals(1, schritt.page)
        assertEquals(1, schritt.slot)
        assertSame(marke, schritt.marke)
        assertEquals(1 to 2, next.page to next.slot)
        // Kein Exemplar bewegt sich: die Karte ist noch gar nicht in der Sammlung.
        assertEquals(start.copies, next.copies)
    }

    @Test fun `Rueckgaengig einer Reservierung gibt die Marke zurueck und springt auf ihr Fach`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 4)
        val marke = Any()
        val (nachReservierung, _) = SortSession.reserve(start, 4, marke)
        val (zurueck, ruecknahme) = SortSession.undo(nachReservierung)!!
        assertTrue(ruecknahme is Ruecknahme.Reservierung)
        assertSame(marke, (ruecknahme as Ruecknahme.Reservierung).marke)
        assertEquals(1 to 1, zurueck.page to zurueck.slot)
        assertTrue(zurueck.schritte.isEmpty())
    }

    @Test fun `Rueckgaengig springt NICHT ueber eine Reservierung hinweg`() {
        // Der Fehler, den der gemeinsame Stapel verhindert: laege die Reservierung daneben, naehme
        // dieses Rueckgaengig die Zuweisung von c1 zurueck -- eine Karte, die der Nutzer nicht
        // gemeint hat -- und liesse die Reservierung stehen.
        val start = SortSession.start(listOf(copy("c1")), "b1", 4)
        val (nachZuweisung, placement) = SortSession.assign(start, "c1", "b1", 4)!!
        val marke = Any()
        val (nachReservierung, _) = SortSession.reserve(nachZuweisung, 4, marke)
        assertEquals(1 to 3, nachReservierung.page to nachReservierung.slot)

        val (erstesZurueck, erste) = SortSession.undo(nachReservierung)!!
        assertSame(marke, (erste as Ruecknahme.Reservierung).marke)
        assertEquals(1 to 2, erstesZurueck.page to erstesZurueck.slot)
        // c1 liegt noch, wo es lag.
        assertEquals("b1", erstesZurueck.copies.first { it.copyId == "c1" }.containerId)

        val (zweitesZurueck, zweite) = SortSession.undo(erstesZurueck)!!
        assertSame(placement, genommen(zweite))
        assertEquals(1 to 1, zweitesZurueck.page to zweitesZurueck.slot)
        assertNull(zweitesZurueck.copies.first { it.copyId == "c1" }.containerId)
    }

    @Test fun `dropStep nimmt den Schritt vom Stapel und laesst sonst alles stehen`() {
        val start = SortSession.start(listOf(copy("c1")), "b1", 4)
        val (nachReservierung, _) = SortSession.reserve(start, 4, Any())
        val danach = SortSession.dropStep(nachReservierung)
        assertTrue(danach.schritte.isEmpty())
        assertEquals(1 to 2, danach.page to danach.slot)      // das Fach bleibt vorgerueckt
        assertEquals(nachReservierung.copies, danach.copies)
        assertNull(SortSession.undo(danach))
    }

    @Test fun `die Seite einer Reservierung zaehlt fuer den Rueckkanal`() {
        // Auch eine Karte, die erst ueber das Staging in die Sammlung kommt, liegt physisch schon
        // im Ordner -- die Binder-Ansicht soll auf ihrer Seite aufschlagen.
        var state = SortSession.start(emptyList(), "b1", 4)
        repeat(4) { state = SortSession.reserve(state, 4, Any()).first }
        assertEquals(2, state.page)
        assertEquals(1, SortSession.lastPage(state))
    }

    // --- Kandidaten fuer die beiden anderen Sheets ---

    @Test fun `chosen behaelt die von PickCandidate gelieferte Reihenfolge`() {
        // Die Arbeitskopie steht andersherum: ein filter wuerde die Vorauswahl (Standard-Exemplare
        // zuerst) stillschweigend zurueckdrehen.
        val copies = listOf(copy("c1"), copy("c2"), copy("c3"))
        assertEquals(
            listOf("c3", "c1"),
            SortSession.chosen(copies, listOf("c3", "c1")).map { it.copyId },
        )
    }

    @Test fun `chosen laesst eine unbekannte Id weg, statt zu werfen`() {
        val copies = listOf(copy("c1"))
        assertEquals(listOf("c1"), SortSession.chosen(copies, listOf("weg", "c1")).map { it.copyId })
    }

    @Test fun `placedCandidates nennt nur einsortierte Exemplare dieser Karte`() {
        val copies = listOf(
            copy("frei"),
            copy("hier", containerId = "b1", page = 1, slot = 1),
            copy("woanders", containerId = "b2", page = 2, slot = 3),
            copy("andereKarte", cardId = "87654321", containerId = "b1", page = 1, slot = 2),
        )
        assertEquals(
            listOf("hier", "woanders"),
            SortSession.placedCandidates(copies, "12345678").map { it.copyId },
        )
    }

    @Test fun `placedCandidates uebergeht geloeschte Exemplare`() {
        val copies = listOf(
            copy("weg", containerId = "b1", page = 1, slot = 1).copy(deleted = true),
            copy("da", containerId = "b1", page = 1, slot = 2),
        )
        assertEquals(listOf("da"), SortSession.placedCandidates(copies, "12345678").map { it.copyId })
    }

    // --- Seite fuer den Rueckkanal (§6.6) ---

    @Test fun `ohne Sitzung ist die Seite fuer den Rueckkanal die erste`() {
        assertEquals(1, SortSession.lastPage(null))
    }

    @Test fun `ohne eingelegte Karte gilt die Seite, auf der der Modus steht`() {
        val s = SortSession.start(listOf(copy("c1", containerId = "b1", page = 1, slot = 1)), "b1", 4)
        assertEquals(1, s.page)
        assertEquals(1, SortSession.lastPage(s))
    }

    @Test fun `nach der letzten Karte gilt deren Seite, nicht die schon vorgerueckte`() {
        // Die vierte Karte eines 4er-Ordners blaettert das Fach auf Seite 2 vor -- aufschlagen
        // soll die Binder-Ansicht trotzdem auf Seite 1, wo die Karte liegt.
        var state = SortSession.start((1..4).map { copy("c$it") }, "b1", 4)
        repeat(4) { i -> state = SortSession.assign(state, "c${i + 1}", "b1", 4)!!.first }
        assertEquals(2, state.page)
        assertEquals(1, SortSession.lastPage(state))
    }

    // --- Warteschlange ---

    private fun placement(copyId: String, page: Int, slot: Int) = Placement(
        copyId = copyId, cardId = "12345678", containerId = "b1", page = page, slot = slot,
        vorherContainerId = null, vorherPage = null, vorherSlot = null,
    )

    @Test fun `eine gescheiterte Schreibung steht hinten in der Warteschlange`() {
        val a = placement("c1", 1, 1)
        val b = placement("c2", 1, 2)
        val q = SortSession.enqueue(SortSession.enqueue(emptyList(), a, false), b, false)
        assertEquals(listOf(a, b), q.map { it.placement })
        assertTrue(q.none { it.zurueck })
    }

    @Test fun `eine erfolgreiche Nachholung entfernt genau ihren Eintrag`() {
        val a = placement("c1", 1, 1)
        val b = placement("c2", 1, 2)
        var q = SortSession.enqueue(emptyList(), a, false)
        q = SortSession.enqueue(q, b, false)
        val rest = SortSession.settled(q, q[0])
        assertEquals(listOf(b), rest.map { it.placement })
    }

    @Test fun `eine Schreibung, die nie in der Warteschlange stand, laesst sie unveraendert`() {
        // Der Normalfall der Oberflaeche: jede Zuweisung geht ZUERST direkt ans Netz, mit einem
        // PendingWrite, der nie eingereiht wurde. Gelingt sie, ruft `writePending` trotzdem
        // `settled` -- das darf dann nichts entfernen, schon gar nicht den inhaltsgleichen
        // Eintrag eines frueheren Fehlschlags.
        val a = placement("c1", 1, 1)
        val q = SortSession.enqueue(emptyList(), a, false)
        val nieEingereiht = PendingWrite(a, false)
        assertEquals(q, SortSession.settled(q, nieEingereiht))
    }

    @Test fun `Rueckgaengig hebt eine noch ungeschriebene Zuweisung auf`() {
        val a = placement("c1", 1, 1)
        val q = SortSession.enqueue(emptyList(), a, false)
        val (rest, mussSchreiben) = SortSession.cancelPending(q, a)
        assertTrue(rest.isEmpty())
        assertFalse(mussSchreiben)
    }

    @Test fun `Rueckgaengig einer bereits geschriebenen Zuweisung muss schreiben`() {
        val a = placement("c1", 1, 1)
        val b = placement("c2", 1, 2)
        val q = SortSession.enqueue(emptyList(), b, false)
        val (rest, mussSchreiben) = SortSession.cancelPending(q, a)
        assertEquals(1, rest.size)
        assertTrue(mussSchreiben)
    }

    @Test fun `eine inhaltsgleiche zweite Zuweisung bleibt in der Warteschlange stehen`() {
        // Identitaet, nicht Inhalt: zwei Zuweisungen mit denselben Feldern sind zwei Vorgaenge.
        val a = placement("c1", 1, 1)
        val b = placement("c1", 1, 1)
        val q = SortSession.enqueue(SortSession.enqueue(emptyList(), a, false), b, false)
        val (rest, mussSchreiben) = SortSession.cancelPending(q, b)
        assertEquals(listOf(a), rest.map { it.placement })
        assertFalse(mussSchreiben)
    }

    @Test fun `eine offene Ruecknahme wird von cancelPending nicht angefasst`() {
        val a = placement("c1", 1, 1)
        val q = SortSession.enqueue(emptyList(), a, true)
        val (rest, mussSchreiben) = SortSession.cancelPending(q, a)
        assertEquals(1, rest.size)
        assertTrue(mussSchreiben)
    }

    // --- Verlust-Meldung ---

    @Test fun `die Verlust-Meldung benennt jedes betroffene Fach`() {
        var q = SortSession.enqueue(emptyList(), placement("c1", 1, 3), false)
        q = SortSession.enqueue(q, placement("c2", 2, 1), false)
        assertEquals(listOf("Seite 1 · Fach 3", "Seite 2 · Fach 1"), SortSession.lossDescriptions(q))
    }

    @Test fun `eine verlorene Ruecknahme ist als solche benannt`() {
        val q = SortSession.enqueue(emptyList(), placement("c1", 4, 2), true)
        assertEquals(listOf("Rückgängig (Seite 4 · Fach 2)"), SortSession.lossDescriptions(q))
    }

    @Test fun `eine leere Warteschlange meldet nichts`() {
        assertTrue(SortSession.lossDescriptions(emptyList()).isEmpty())
    }

    // --- Verwaiste Reservierungen (Fixrunde 1, Minor 6) ---

    /** Steht fuer einen Staging-Eintrag. Bewusst ohne Inhalt: verglichen wird nur die Identitaet. */
    private class Marke

    @Test fun `eine Reservierung mit bekannter Marke ist nicht verwaist`() {
        val m = Marke()
        val (s, _) = SortSession.reserve(SortSession.start(emptyList(), "b1", 4), 4, m)
        assertTrue(SortSession.orphanedReservations(s, listOf(m)).isEmpty())
    }

    @Test fun `eine Reservierung ohne bekannte Marke nennt Seite und Fach`() {
        val m = Marke()
        val (s, _) = SortSession.reserve(SortSession.start(emptyList(), "b1", 4), 4, m)
        assertEquals(listOf("Seite 1 · Fach 1"), SortSession.orphanedReservations(s, emptyList()))
    }

    @Test fun `verwaist entscheidet die Identitaet, nicht der Inhalt`() {
        // Zwei inhaltsgleiche Marken (beide leer!): nur die unbekannte darf gemeldet werden.
        val bekannt = Marke()
        val weg = Marke()
        var s = SortSession.reserve(SortSession.start(emptyList(), "b1", 4), 4, bekannt).first
        s = SortSession.reserve(s, 4, weg).first
        assertEquals(listOf("Seite 1 · Fach 2"), SortSession.orphanedReservations(s, listOf(bekannt)))
    }

    @Test fun `eine Zuweisung ist nie verwaist`() {
        val start: SortState = SortSession.start(listOf(copy("c1")), "b1", 4)
        val (s, _) = SortSession.assign(start, "c1", "b1", 4)!!
        assertTrue(SortSession.orphanedReservations(s, emptyList()).isEmpty())
    }

    @Test fun `eine zurueckgenommene Reservierung taucht nicht mehr auf`() {
        val m = Marke()
        val (s, _) = SortSession.reserve(SortSession.start(emptyList(), "b1", 4), 4, m)
        val (zurueck, _) = SortSession.undo(s)!!
        assertTrue(SortSession.orphanedReservations(zurueck, emptyList()).isEmpty())
    }

    @Test fun `eine Reservierung ohne Marke gilt als verwaist`() {
        // null laesst sich keinem Eintrag zuordnen -- Schweigen waere hier die schlechtere Antwort.
        val (s, _) = SortSession.reserve(SortSession.start(emptyList(), "b1", 4), 4, null)
        assertEquals(listOf("Seite 1 · Fach 1"), SortSession.orphanedReservations(s, listOf(Marke())))
    }

    @Test fun `ohne Zustand gibt es nichts zu melden`() {
        assertTrue(SortSession.orphanedReservations(null, emptyList()).isEmpty())
    }

    // --- Zusammenspiel ---

    @Test fun `Zuweisung ohne Netz, dann Rueckgaengig, laesst nichts zu schreiben uebrig`() {
        val start: SortState = SortSession.start(listOf(copy("c1")), "b1", 9)
        val (nachZuweisung, p) = SortSession.assign(start, "c1", "b1", 9)!!
        var queue = SortSession.enqueue(emptyList(), p, false)     // Netzfehler
        val (zurueck, zurueckgenommen) = SortSession.undo(nachZuweisung)!!
        val (rest, mussSchreiben) = SortSession.cancelPending(queue, genommen(zurueckgenommen))
        queue = rest
        assertTrue(queue.isEmpty())
        assertFalse(mussSchreiben)
        assertEquals(1 to 1, zurueck.page to zurueck.slot)
        assertNotNull(zurueck)
    }
}
