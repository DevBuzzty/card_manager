package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceHistoryRepository
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.ml.PriceRef
import org.junit.Assert.assertEquals
import org.junit.Test

class PriceHistoryQueriesTest {
    @Test fun `Referenz erste Seite nach Schluessel sortiert`() {
        assertEquals(
            listOf("order" to "card_id.asc,set_code.asc,language.asc,rarity.asc", "limit" to "1000"),
            PriceHistoryRepository.referenceParams(null),
        )
    }

    @Test fun `Referenz Folgeseite mit Keyset-Filter`() {
        val p = PriceHistoryRepository.referenceParams(PriceRef("1", "LOB-DE001", "DE", "Secret Rare", "2026-09-01", 1.0, "cm_bulk"))
        assertEquals("or", p.last().first)
        assertEquals(
            "(card_id.gt.\"1\",and(card_id.eq.\"1\",set_code.gt.\"LOB-DE001\"),and(card_id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.gt.\"DE\"),and(card_id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.eq.\"DE\",rarity.gt.\"Secret Rare\"))",
            p.last().second,
        )
    }

    @Test fun `Verlauf eines Printings, fehlende Raritaet als Unknown, neueste zuerst`() {
        val card = CardRow("1", "LOB-DE001", "DE", "A", null, null, 1, 2.0)
        assertEquals(
            listOf(
                "select" to "card_id,set_code,language,rarity,day,price,source",
                "card_id" to "eq.1", "set_code" to "eq.LOB-DE001", "language" to "eq.DE", "rarity" to "eq.Unknown",
                "variant" to "eq.base", "order" to "day.desc", "limit" to "1000",
            ),
            PriceHistoryRepository.historyParams(card),
        )
    }

    @Test fun `parse liest Zeilen`() {
        val r = PriceHistoryRepository.parse("""[{"card_id":"1","set_code":"A","language":"DE","rarity":"Common","day":"2026-09-01","price":2.5,"source":"cloud"}]""")
        assertEquals(listOf(PriceRef("1", "A", "DE", "Common", "2026-09-01", 2.5, "cloud")), r)
    }

    @Test fun `Snapshots juengste 1000, aufsteigend geliefert`() {
        assertEquals(
            listOf("select" to "day,total_value", "order" to "day.desc", "limit" to "1000"),
            SnapshotsRepository.snapshotParams(),
        )
        val s = SnapshotsRepository.parseSnapshots("""[{"day":"2026-09-14","total_value":2},{"day":"2026-09-13","total_value":1}]""")
        assertEquals(listOf("2026-09-13", "2026-09-14"), s.map { it.day })
    }
}
