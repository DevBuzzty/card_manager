package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.BinderBreakdown

/**
 * Merkt BinderBreakdown.compute ueber Reiter- und Seitenwechsel hinweg (Spec G1 §4.7, Muster DashboardMemo):
 * Der Speicher liefert bei unveraenderten Daten dieselben Listeninstanzen, also genuegt `===`.
 */
object BinderBreakdownMemo {
    private val lock = Any()
    private var lastCards: List<CardRow>? = null
    private var lastCopies: List<CopyRow>? = null
    private var lastContainers: List<ContainerRow>? = null
    private var lastResult: List<StatGroup>? = null

    /** Rechnet nur neu, wenn sich eine der drei Listen als Referenz geaendert hat. */
    fun get(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): List<StatGroup> = synchronized(lock) {
        val cached = lastResult
        if (cached != null && lastCards === cards && lastCopies === copies && lastContainers === containers) return@synchronized cached
        BinderBreakdown.compute(cards, copies, containers).map { StatGroup(it.label, it.count, it.value) }.also {
            lastCards = cards; lastCopies = copies; lastContainers = containers; lastResult = it
        }
    }

    /** Wie [get], aber ohne zu rechnen: liefert den Treffer nur, falls die Referenzen bereits passen. */
    fun peek(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): List<StatGroup>? = synchronized(lock) {
        if (lastResult != null && lastCards === cards && lastCopies === copies && lastContainers === containers) lastResult else null
    }
}
