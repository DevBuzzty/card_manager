package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class ValueGroup(val label: String, val count: Int, val value: Double)

/**
 * Spec G1 §4.7 -- Aufteilung nach Binder: lebende Exemplare je Behaelter mit Preis x Zustandsfaktor.
 * Gegenstueck der Binder-Dimension in desktop/src/utils/breakdown.js (kein Zwilling: dort zaehlt der
 * Desktop auch Typ/Set/Raritaet anders zusammen).
 */
object BinderBreakdown {
    const val UNSORTED = "Nicht einsortiert"

    fun compute(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): List<ValueGroup> {
        val price = cards.associate { it.printingKey() to (it.price ?: 0.0) }
        val names = containers.filter { !it.deleted }.associate { it.containerId to it.name }
        val count = LinkedHashMap<String, Int>()
        val value = HashMap<String, Double>()
        for (c in copies) {
            if (c.deleted) continue
            val label = c.containerId?.let { names[it] } ?: UNSORTED
            count[label] = (count[label] ?: 0) + 1
            value[label] = (value[label] ?: 0.0) + (price[c.printingKey()] ?: 0.0) * Valuation.factor(c.condition)
        }
        return count.keys
            .map { ValueGroup(it, count[it] ?: 0, Math.round((value[it] ?: 0.0) * 100.0) / 100.0) }
            .sortedWith(compareByDescending<ValueGroup> { it.value }.thenBy { it.label })
    }
}
