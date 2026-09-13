package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.UnsortedCopies
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die abgeleitete Liste der nicht einsortierten Exemplare muss Zeile fuer Zeile das liefern, was
 * bisher ein eigener Netzaufruf lieferte (`order=created_at.asc,copy_id.asc`, PostgREST, also
 * NULLS LAST). Die Reihenfolge ist im Fach-Fuellen-Sheet und in der Liste "Nicht einsortiert"
 * sichtbar; sie ist der ganze Grund, warum es diesen Helfer gibt.
 *
 * Dieselbe Regel am Desktop: `desktop/electron/copies.cjs#listUnsortedCopies`
 * (`ORDER BY cp.created_at, cp.copy_id`).
 */
class UnsortedCopiesTest {

    private fun copy(copyId: String, containerId: String? = null, createdAt: String? = null, deleted: Boolean = false) = CopyRow(
        copyId = copyId, cardId = "12345678", setCode = "LOB-DE001", language = "DE",
        rarity = "Common", edition = "unlimited", condition = "NM", deleted = deleted,
        containerId = containerId, page = null, slot = null, tags = null, note = null,
        createdAt = createdAt,
    )

    @Test fun `nur Exemplare ohne Behaelter`() {
        val out = UnsortedCopies.from(
            listOf(
                copy("a", createdAt = "2026-01-01T10:00:00+00:00"),
                copy("b", containerId = "b1", createdAt = "2026-01-01T09:00:00+00:00"),
                copy("c", containerId = "box7", createdAt = "2026-01-01T08:00:00+00:00"),
            )
        )
        assertEquals(listOf("a"), out.map { it.copyId })
    }

    @Test fun `geloeschte Exemplare zaehlen nicht als unsortiert`() {
        val out = UnsortedCopies.from(
            listOf(
                copy("lebt", createdAt = "2026-01-01T10:00:00+00:00"),
                copy("weg", createdAt = "2026-01-01T09:00:00+00:00", deleted = true),
            )
        )
        assertEquals(listOf("lebt"), out.map { it.copyId })
    }

    @Test fun `aeltestes Exemplar zuerst`() {
        val out = UnsortedCopies.from(
            listOf(
                copy("spaet", createdAt = "2026-03-01T00:00:00+00:00"),
                copy("frueh", createdAt = "2026-01-01T00:00:00+00:00"),
                copy("mitte", createdAt = "2026-02-01T00:00:00+00:00"),
            )
        )
        assertEquals(listOf("frueh", "mitte", "spaet"), out.map { it.copyId })
    }

    @Test fun `bei gleichem Zeitstempel entscheidet die copy_id`() {
        val t = "2026-01-01T12:00:00+00:00"
        val out = UnsortedCopies.from(
            listOf(copy("ccc", createdAt = t), copy("aaa", createdAt = t), copy("bbb", createdAt = t))
        )
        assertEquals(listOf("aaa", "bbb", "ccc"), out.map { it.copyId })
    }

    @Test fun `Exemplare ohne Zeitstempel stehen hinten, untereinander nach copy_id`() {
        // So verhaelt sich order=created_at.asc in PostgREST (PostgreSQL: ASC = NULLS LAST) --
        // genau die Reihenfolge, die bisher vom Server kam.
        val out = UnsortedCopies.from(
            listOf(
                copy("zzz-ohne", createdAt = null),
                copy("mit", createdAt = "2026-05-05T00:00:00+00:00"),
                copy("aaa-ohne", createdAt = null),
            )
        )
        assertEquals(listOf("mit", "aaa-ohne", "zzz-ohne"), out.map { it.copyId })
    }

    @Test fun `Sekundenbruchteile werden nicht falsch herum sortiert`() {
        // PostgreSQL schneidet nachlaufende Nullen ab (".7" statt ".700000"), fuehrende bleiben
        // stehen (".07"). Der Zeichenkettenvergleich muss trotzdem die zeitliche Ordnung treffen.
        val out = UnsortedCopies.from(
            listOf(
                copy("d", createdAt = "2026-01-01T00:00:01+00:00"),
                copy("c", createdAt = "2026-01-01T00:00:00.7+00:00"),
                copy("a", createdAt = "2026-01-01T00:00:00+00:00"),
                copy("b", createdAt = "2026-01-01T00:00:00.07+00:00"),
            )
        )
        assertEquals(listOf("a", "b", "c", "d"), out.map { it.copyId })
    }

    @Test fun `leere Eingabe ergibt eine leere Liste`() {
        assertTrue(UnsortedCopies.from(emptyList()).isEmpty())
    }

    @Test fun `die Eingabeliste bleibt unveraendert`() {
        val input = listOf(
            copy("b", createdAt = "2026-02-01T00:00:00+00:00"),
            copy("a", createdAt = "2026-01-01T00:00:00+00:00"),
        )
        UnsortedCopies.from(input)
        assertEquals(listOf("b", "a"), input.map { it.copyId })
    }
}
