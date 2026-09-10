package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Pick
import com.example.yugiohscanner.ml.PickCandidate
import org.junit.Assert.assertEquals
import org.junit.Test

class PickCandidateTest {

    private fun copy(
        copyId: String,
        cardId: String = "12345678",
        setCode: String = "ABC-DE001",
        edition: String = "unlimited",
        condition: String = "NM",
        deleted: Boolean = false,
        containerId: String? = null,
    ) = CopyRow(
        copyId = copyId,
        cardId = cardId,
        setCode = setCode,
        language = "DE",
        rarity = "Common",
        edition = edition,
        condition = condition,
        deleted = deleted,
        containerId = containerId,
        page = if (containerId == null) null else 1,
        slot = if (containerId == null) null else 1,
        tags = null,
        note = null,
    )

    @Test fun `genau ein Kandidat ergibt One`() {
        val copies = listOf(copy("c1"))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.One("c1"), result)
    }

    @Test fun `mehrere Kandidaten ergeben Many`() {
        val copies = listOf(copy("c1"), copy("c2"))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c1", "c2")), result)
    }

    @Test fun `keine unsortierten Exemplare aber Passcode vorhanden ergibt AllPlaced`() {
        val copies = listOf(copy("c1", containerId = "box-1"))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.AllPlaced, result)
    }

    @Test fun `Passcode kommt gar nicht vor ergibt NotOwned`() {
        val copies = listOf(copy("c1", cardId = "99999999"))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.NotOwned, result)
    }

    @Test fun `leere copies Liste ergibt NotOwned`() {
        val result = PickCandidate.pick(emptyList(), "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.NotOwned, result)
    }

    @Test fun `nur geloeschte Exemplare zaehlen als NotOwned`() {
        val copies = listOf(copy("c1", deleted = true), copy("c2", containerId = "box-1", deleted = true))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.NotOwned, result)
    }

    @Test fun `Set-Code grenzt auf das passende Printing ein`() {
        val copies = listOf(copy("c1", setCode = "ABC-DE001"), copy("c2", setCode = "XYZ-DE099"))
        val result = PickCandidate.pick(copies, "12345678", listOf("XYZ-DE099"), "unlimited", "NM")
        assertEquals(Pick.One("c2"), result)
    }

    @Test fun `Set-Code Vergleich ignoriert Gross-Kleinschreibung`() {
        val copies = listOf(copy("c1", setCode = "ABC-DE001"), copy("c2", setCode = "XYZ-DE099"))
        val result = PickCandidate.pick(copies, "12345678", listOf("xyz-de099"), "unlimited", "NM")
        assertEquals(Pick.One("c2"), result)
    }

    @Test fun `Eingrenzung die alles wegfiltern wuerde greift nicht`() {
        val copies = listOf(copy("c1", setCode = "ABC-DE001"), copy("c2", setCode = "ABC-DE001"))
        val result = PickCandidate.pick(copies, "12345678", listOf("NICHT-VORHANDEN"), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c1", "c2")), result)
    }

    @Test fun `leere setCodes Liste grenzt nichts ein`() {
        val copies = listOf(copy("c1"), copy("c2"))
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c1", "c2")), result)
    }

    @Test fun `Many stellt Standard-Exemplare voran`() {
        val abweichend = copy("c1", edition = "first", condition = "NM")
        val standard1 = copy("c2", edition = "unlimited", condition = "NM")
        val standard2 = copy("c3", edition = "unlimited", condition = "NM")
        val copies = listOf(abweichend, standard1, standard2)
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c2", "c3", "c1")), result)
    }

    @Test fun `Many haelt die Eingabereihenfolge innerhalb beider Gruppen`() {
        val standard1 = copy("c1", edition = "unlimited", condition = "NM")
        val abweichend1 = copy("c2", edition = "first", condition = "NM")
        val standard2 = copy("c3", edition = "unlimited", condition = "NM")
        val abweichend2 = copy("c4", edition = "unlimited", condition = "LP")
        val copies = listOf(standard1, abweichend1, standard2, abweichend2)
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c1", "c3", "c2", "c4")), result)
    }

    @Test fun `nur Edition abweichend zaehlt schon als nicht Standard`() {
        val abweichend = copy("c1", edition = "first", condition = "NM")
        val standard = copy("c2", edition = "unlimited", condition = "NM")
        val copies = listOf(abweichend, standard)
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c2", "c1")), result)
    }

    @Test fun `nur Zustand abweichend zaehlt schon als nicht Standard`() {
        val abweichend = copy("c1", edition = "unlimited", condition = "LP")
        val standard = copy("c2", edition = "unlimited", condition = "NM")
        val copies = listOf(abweichend, standard)
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.Many(listOf("c2", "c1")), result)
    }

    @Test fun `einsortierte Exemplare zaehlen nicht als Kandidat auch mit passendem Set-Code`() {
        val eingeordnet = copy("c1", setCode = "ABC-DE001", containerId = "box-1")
        val frei = copy("c2", setCode = "ABC-DE001")
        val copies = listOf(eingeordnet, frei)
        val result = PickCandidate.pick(copies, "12345678", emptyList(), "unlimited", "NM")
        assertEquals(Pick.One("c2"), result)
    }
}
