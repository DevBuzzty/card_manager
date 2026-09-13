package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ui.theme.Line

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
    type?.contains("Monster", ignoreCase = true) == true -> "Monster"
    else -> "Sonstige"
}

// Value of one printing, from its cached price and the copies actually owned of it.
internal fun printingValue(c: CardRow, byKey: Map<String, List<CopyRow>>): Double =
    Valuation.valueOf(c.price, byKey[c.printingKey()] ?: emptyList())

// Groups cards by a key (skipping null keys and cards failing `include`), summing
// quantity and copy-based value. Returns label -> (count, value), insertion-ordered.
private fun groupCards(
    cards: List<CardRow>,
    byKey: Map<String, List<CopyRow>>,
    include: (CardRow) -> Boolean = { true },
    keyOf: (CardRow) -> String?,
): List<StatGroup> {
    val m = LinkedHashMap<String, Pair<Int, Double>>()
    for (c in cards) {
        if (!include(c)) continue
        val k = keyOf(c) ?: continue
        val cur = m[k] ?: (0 to 0.0)
        m[k] = (cur.first + c.quantity) to (cur.second + printingValue(c, byKey))
    }
    return m.map { StatGroup(it.key, it.value.first, it.value.second) }
}

// Pure: derive all dashboard metrics + breakdowns from the loaded collection.
fun computeDashboard(cards: List<CardRow>, copies: List<CopyRow>): Dashboard {
    val byKey = copies.groupBy { it.printingKey() }
    val totalValue = cards.sumOf { printingValue(it, byKey) }
    val totalCards = cards.sumOf { it.quantity }
    val top = cards.sortedByDescending { printingValue(it, byKey) }.take(10)

    val byRarity = groupCards(cards, byKey) { it.rarity ?: "Unbekannt" }
        .sortedBy { rarityRank(if (it.label == "Unbekannt") null else it.label) }

    val typeOrder = listOf("Monster", "Zauber", "Falle", "Sonstige")
    val typeMap = groupCards(cards, byKey) { typeGroup(it.type) }.associateBy { it.label }
    val byType = typeOrder.mapNotNull { typeMap[it] }

    val bySet = groupCards(cards, byKey) { it.setCode }
        .sortedByDescending { it.count }.take(10)

    val byAttribute = groupCards(cards, byKey, include = { !it.attribute.isNullOrBlank() }) { it.attribute }
        .sortedByDescending { it.count }

    return Dashboard(totalValue, totalCards, cards.size, top, byRarity, byType, bySet, byAttribute)
}

// Neutraler Platzhalter, solange `DashboardMemo` im Hintergrund noch rechnet (Befund A, Punkt 3):
// zeigt 0 €/keine Daten statt eines Ladebildschirms, ohne die Seite umzubauen.
val EmptyDashboard = Dashboard(0.0, 0, 0, emptyList(), emptyList(), emptyList(), emptyList(), emptyList())

// Merkt sich `computeDashboard` ueber Navigationen hinweg (Befund A): Karten/Exemplare aendern
// sich bei einem Abgleich ohne Unterschied NICHT in ihrer Identitaet (CollectionStore liefert
// dieselben Listeninstanzen), also genuegt ein Vergleich per `===` statt teurer Inhaltsvergleiche.
// Von mehreren Threads aus aufrufbar (Anzeige + Tageswert-Speicherung), daher `synchronized`.
object DashboardMemo {
    private val lock = Any()
    private var lastCards: List<CardRow>? = null
    private var lastCopies: List<CopyRow>? = null
    private var lastResult: Dashboard? = null

    /** Rechnet nur neu, wenn sich `cards` oder `copies` als Referenz geaendert haben. */
    fun get(cards: List<CardRow>, copies: List<CopyRow>): Dashboard = synchronized(lock) {
        val cached = lastResult
        if (cached != null && lastCards === cards && lastCopies === copies) return@synchronized cached
        computeDashboard(cards, copies).also {
            lastCards = cards
            lastCopies = copies
            lastResult = it
        }
    }

    /** Wie [get], aber ohne zu rechnen: liefert den Treffer nur, falls die Referenzen bereits passen. */
    fun peek(cards: List<CardRow>, copies: List<CopyRow>): Dashboard? = synchronized(lock) {
        if (lastResult != null && lastCards === cards && lastCopies === copies) lastResult else null
    }
}

// A labelled horizontal bar: label + "count · value €" on top, a proportional bar below.
@Composable
fun StatBar(label: String, count: Int, value: Double, fraction: Float) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Text("$count · %.2f €".format(value), style = MaterialTheme.typography.bodySmall)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).background(Line, RoundedCornerShape(3.dp))) {
            Box(
                Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp)
                    .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(3.dp))
            )
        }
    }
}
