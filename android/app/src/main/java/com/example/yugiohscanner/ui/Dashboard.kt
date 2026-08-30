package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow

// One row of a breakdown: a label with its card count and summed value.
data class StatGroup(val label: String, val count: Int, val value: Double)

data class Dashboard(
    val totalValue: Double,
    val totalCards: Int,
    val entries: Int,
    val top: List<CardRow>,
    val byRarity: List<StatGroup>,
    val byType: List<StatGroup>,
    val bySet: List<StatGroup>,
    val byAttribute: List<StatGroup>,
)

private fun rarityRank(r: String?): Int = when (r?.lowercase()) {
    "common" -> 1
    "short print" -> 2
    "rare" -> 3
    "super rare" -> 4
    "ultra rare" -> 5
    "secret rare" -> 6
    else -> 10
}

private fun typeGroup(type: String?): String = when {
    type?.contains("Spell", ignoreCase = true) == true -> "Zauber"
    type?.contains("Trap", ignoreCase = true) == true -> "Falle"
    else -> "Monster"
}

// Groups cards by a key (skipping null keys and cards failing `include`), summing
// quantity and price*quantity. Returns label -> (count, value), insertion-ordered.
private fun groupCards(
    cards: List<CardRow>,
    include: (CardRow) -> Boolean = { true },
    keyOf: (CardRow) -> String?,
): List<StatGroup> {
    val m = LinkedHashMap<String, Pair<Int, Double>>()
    for (c in cards) {
        if (!include(c)) continue
        val k = keyOf(c) ?: continue
        val cur = m[k] ?: (0 to 0.0)
        m[k] = (cur.first + c.quantity) to (cur.second + (c.price ?: 0.0) * c.quantity)
    }
    return m.map { StatGroup(it.key, it.value.first, it.value.second) }
}

// Pure: derive all dashboard metrics + breakdowns from the loaded collection.
fun computeDashboard(cards: List<CardRow>): Dashboard {
    val totalValue = cards.sumOf { (it.price ?: 0.0) * it.quantity }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { (it.price ?: 0.0) * it.quantity }.take(10)

    val byRarity = groupCards(cards) { it.rarity ?: "Unbekannt" }
        .sortedBy { rarityRank(if (it.label == "Unbekannt") null else it.label) }

    val typeOrder = listOf("Monster", "Zauber", "Falle")
    val typeMap = groupCards(cards) { typeGroup(it.type) }.associateBy { it.label }
    val byType = typeOrder.mapNotNull { typeMap[it] }

    val bySet = groupCards(cards) { it.setCode }
        .sortedByDescending { it.count }.take(10)

    val byAttribute = groupCards(cards, include = { !it.attribute.isNullOrBlank() }) { it.attribute }
        .sortedByDescending { it.count }

    return Dashboard(totalValue, totalCards, cards.size, top, byRarity, byType, bySet, byAttribute)
}

// A labelled horizontal bar: label + "count · value €" on top, a proportional bar below.
@Composable
fun StatBar(label: String, count: Int, value: Double, fraction: Float) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Text("$count · %.2f €".format(value), style = MaterialTheme.typography.bodySmall)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(
                Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp)
                    .background(MaterialTheme.colorScheme.primary)
            )
        }
    }
}
