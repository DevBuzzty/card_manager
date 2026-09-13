package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.TagVocabulary
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tag-Vorschlaege aus den Exemplaren im Speicher statt aus einem eigenen Netzaufruf. Muss dasselbe
 * liefern wie das abgeloeste CollectionRepository.listTags(): lebende Exemplare in der Reihenfolge
 * created_at, copy_id; ueber Tags.parse/Tags.add zusammengefuehrt; am Ende ohne Gross/klein sortiert.
 */
class TagVocabularyTest {

    private fun copy(id: String, tags: String?, createdAt: String?, deleted: Boolean = false) = CopyRow(
        copyId = id, cardId = "1", setCode = "LOB-DE001", language = "DE", rarity = "Common",
        edition = "unlimited", condition = "NM", deleted = deleted, containerId = null, page = null,
        slot = null, tags = tags, note = null, createdAt = createdAt,
    )

    @Test fun `alle Tags lebender Exemplare, ohne Gross-klein sortiert`() {
        val out = TagVocabulary.from(listOf(
            copy("a", "[\"zeta\",\"Alpha\"]", "2026-01-01T00:00:00+00:00"),
            copy("b", "[\"beta\"]", "2026-01-02T00:00:00+00:00"),
            copy("c", "[\"geloescht\"]", "2026-01-03T00:00:00+00:00", deleted = true),
            copy("d", null, "2026-01-04T00:00:00+00:00"),
        ))
        assertEquals(listOf("Alpha", "beta", "zeta"), out)
    }

    @Test fun `die Schreibweise des aeltesten Exemplars gewinnt`() {
        val out = TagVocabulary.from(listOf(
            copy("neu", "[\"tausch\"]", "2026-02-01T00:00:00+00:00"),
            copy("alt", "[\"Tausch\"]", "2026-01-01T00:00:00+00:00"),
        ))
        assertEquals(listOf("Tausch"), out)
    }

    @Test fun `kaputte Tag-Zelle bedeutet keine Tags`() {
        assertEquals(emptyList<String>(), TagVocabulary.from(listOf(copy("a", "kein json", "2026-01-01T00:00:00+00:00"))))
    }
}
