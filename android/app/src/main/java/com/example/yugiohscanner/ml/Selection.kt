package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.printingKey

/**
 * Mehrfachauswahl in der Kartenliste (Spec I §5.1, Plan 2026-09-26) -- welche Exemplare zur Auswahl gehören, und die Texte.
 * ZWILLING von desktop/src/utils/selection.js, gemeinsame Fixture docs/fixtures/copies/selection.json. Wer eine Fassung
 * ändert, ändert beide. Namensabweichung: JS-Gruppen `{ id, variants }` = hier Paare (Gruppen-id, Drucke).
 * Sortierung per Codeeinheiten (String.compareTo).
 */
object Selection {
    /** Lebende Exemplare aller Drucke der gewählten Karten (bei Behälter-Filter nur die darin), sortiert nach copy_id. */
    fun copies(groups: List<Pair<String, List<CardRow>>>, selected: Set<String>, copies: List<CopyRow>, containers: Set<String> = emptySet()): List<CopyRow> {
        val keys = HashSet<String>()
        for ((id, variants) in groups) if (id in selected) variants.forEach { keys += it.printingKey() }
        return copies.filter { !it.deleted && it.printingKey() in keys && (containers.isEmpty() || it.containerId in containers) }
            .sortedBy { it.copyId }
    }

    private fun cardsWord(n: Int) = if (n == 1) "Karte" else "Karten"
    private fun copiesWord(n: Int) = if (n == 1) "Exemplar" else "Exemplare"

    fun text(cards: Int, copies: Int): String =
        if (cards == 0) "Nichts ausgewählt" else "$cards ${cardsWord(cards)} · $copies ${copiesWord(copies)}"

    fun sellSubtitle(cards: Int, copies: Int): String = "$cards ${cardsWord(cards)} · $copies ${copiesWord(copies)} ausgewählt"

    /** target: Name des Ziel-Behälters oder null (= aus dem Behälter nehmen). */
    fun moveText(count: Int, target: String?): String = when {
        count == 0 -> "Nichts verschoben – alle Exemplare waren schon dort"
        target == null && count == 1 -> "1 Exemplar aus seinem Behälter genommen"
        target == null -> "$count Exemplare aus ihren Behältern genommen"
        else -> "$count ${copiesWord(count)} nach „$target“ verschoben"
    }
}
