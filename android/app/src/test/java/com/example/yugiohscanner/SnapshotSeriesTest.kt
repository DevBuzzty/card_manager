package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Snapshot
import com.example.yugiohscanner.ml.SnapshotSeries
import org.junit.Assert.assertEquals
import org.junit.Test

class SnapshotSeriesTest {
    @Test fun `heutigen Punkt ersetzen`() {
        val l = listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 11.0))
        assertEquals(listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 12.5)), SnapshotSeries.withToday(l, "2026-09-14", 12.5))
    }
    @Test fun `heutigen Punkt anhaengen`() {
        val l = listOf(Snapshot("2026-09-13", 10.0))
        assertEquals(listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 9.0)), SnapshotSeries.withToday(l, "2026-09-14", 9.0))
    }
    @Test fun `leere Liste`() {
        assertEquals(listOf(Snapshot("2026-09-14", 9.0)), SnapshotSeries.withToday(emptyList(), "2026-09-14", 9.0))
    }
}
