package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import org.junit.Assert.assertEquals
import org.junit.Test

// Spec B1 Task 10: CopyLocation.format() muss zeichengleich zu
// desktop/src/utils/copyLocation.js#formatCopyLocation sein -- dieselben drei Formen, dasselbe
// Trennzeichen, dieselben Praefixe, derselbe Gedankenstrich.
class CopyLocationTest {

    private fun copy(containerId: String?, page: Int?, slot: Int?) =
        CopyRow(
            copyId = "c1", cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Ultra Rare",
            edition = "unknown", condition = "NM", deleted = false,
            containerId = containerId, page = page, slot = slot, tags = null, note = null,
        )

    private fun container(kind: String = "binder") =
        ContainerRow(containerId = "b1", name = "Mein Ordner", kind = kind, pocketsPerPage = 9, color = null, sortOrder = 0)

    @Test fun `Binder mit Seite und Fach`() {
        assertEquals("Mein Ordner · S3 · F7", CopyLocation.format(copy("b1", 3, 7), container()))
    }

    @Test fun `Behaelter ohne Seite oder Fach`() {
        assertEquals("Mein Ordner", CopyLocation.format(copy("b1", null, null), container("box")))
    }

    @Test fun `kein Behaelter zugewiesen`() {
        assertEquals("—", CopyLocation.format(copy(null, null, null), null))
    }

    @Test fun `Behaelter zugewiesen aber Behaelter-Zeile noch nicht geladen`() {
        // z.B. waehrend ContainersRepository.list() noch laedt -- container ist dann null,
        // obwohl copy.containerId gesetzt ist. Muss "—" liefern, nicht abstuerzen.
        assertEquals("—", CopyLocation.format(copy("b1", 3, 7), null))
    }

    @Test fun `nur Seite ohne Fach zeigt nur den Namen`() {
        // formatCopyLocation verlangt BEIDE (page und slot) -- eines allein reicht nicht,
        // exakt wie in der JS-Fassung (`copy.page != null && copy.slot != null`).
        assertEquals("Mein Ordner", CopyLocation.format(copy("b1", 3, null), container()))
    }
}
