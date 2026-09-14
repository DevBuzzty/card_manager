package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.Snapshot

/** Spec G1 §4.4: den heutigen Tageswert in die gemerkte Reihe eintragen, statt alles neu zu laden. */
object SnapshotSeries {
    fun withToday(list: List<Snapshot>, day: String, total: Double): List<Snapshot> {
        val last = list.lastOrNull()
        return if (last != null && last.day == day) list.dropLast(1) + Snapshot(day, total) else list + Snapshot(day, total)
    }
}
