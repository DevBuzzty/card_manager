package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class FillRow(val copy: CopyRow, val card: CardRow, val group: Int)

data class FillProposal(val rows: List<FillRow>, val short: Int, val surplus: Int)

/**
 * Spec E1 §7 -- Vorschlag "Box befüllen" und die Texte des Sheets.
 * ZWILLING: desktop/src/utils/fillBoxProposal.js. Beide laufen gegen docs/fixtures/decks/fill-box.json.
 * Wer eine Seite aendert, aendert beide.
 */
object FillBoxProposal {
    /** 1 unsortiert (auch: Behaelter unbekannt), 2 Box oder keinem Deck zugeordnete Deckbox, 3 Ordner. */
    private fun groupOf(copy: CopyRow, containersById: Map<String, ContainerRow>): Int {
        val c = copy.containerId?.let { containersById[it] } ?: return 1
        return if (c.kind == "binder") 3 else 2
    }

    /** null ohne gueltige Deckbox. */
    fun compute(
        deckId: Long,
        deckCards: List<DeckCard>,
        copies: List<CopyRow>,
        cards: List<CardRow>,
        decks: List<Deck>,
        containers: List<ContainerRow>,
    ): FillProposal? {
        val cov = DeckCoverage.compute(deckId, deckCards, copies, cards, decks, containers, emptyMap())
        val box = cov.boxId ?: return null
        val valid = DeckCoverage.validDeckboxIds(containers)
        val reservedBoxes = decks.filter { it.id != deckId }.mapNotNullTo(HashSet()) { d -> d.containerId?.takeIf { it in valid } }
        val containersById = containers.filter { !it.deleted }.associateBy { it.containerId }
        val cardsByKey = cards.filter { !it.deleted }.associateBy { it.printingKey() }
        val live = copies.filter { !it.deleted && cardsByKey.containsKey(it.printingKey()) }

        val rows = ArrayList<FillRow>()
        for (c in cov.cards) {
            val take = maxOf(0, minOf(c.needed - c.inBox, c.available - c.inBox))
            if (take == 0) continue
            live.asSequence()
                .filter { it.cardId == c.cardId && it.containerId != box && (it.containerId == null || it.containerId !in reservedBoxes) }
                .map { cp ->
                    val card = cardsByKey.getValue(cp.printingKey())
                    Triple(FillRow(cp, card, groupOf(cp, containersById)), Valuation.unitPrice(card, cp) * Valuation.factor(cp.condition), cp.copyId)
                }
                .sortedWith(compareBy<Triple<FillRow, Double, String>>({ it.first.group }, { it.second }, { it.third }))
                .take(take)
                .forEach { rows.add(it.first) }
        }

        val needed = cov.cards.associate { it.cardId to it.needed }
        var surplus = 0
        for ((cardId, n) in live.filter { it.containerId == box }.groupingBy { it.cardId }.eachCount()) {
            surplus += maxOf(0, n - (needed[cardId] ?: 0))
        }
        return FillProposal(rows, cov.totals.missing, surplus)
    }

    fun locationText(copy: CopyRow, container: ContainerRow?): String {
        if (copy.containerId == null || container == null) return "unsortiert"
        if (container.kind == "binder" && copy.page != null && copy.slot != null) return "${container.name} · S. ${copy.page} · Fach ${copy.slot}"
        return container.name
    }

    fun shortText(n: Int): String? = when (n) {
        0 -> null
        1 -> "1 fehlt noch – nicht in der Sammlung"
        else -> "$n fehlen noch – nicht in der Sammlung"
    }

    fun surplusText(n: Int): String? = if (n == 0) null else "$n überzählig in der Box"
}
