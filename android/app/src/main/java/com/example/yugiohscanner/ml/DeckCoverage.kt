package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.printingKey
import java.util.Locale

data class Reserved(val deckId: Long, val name: String, val count: Int)

data class CoverageCard(
    val cardId: String,
    val needed: Int,
    val inBox: Int,
    val available: Int,
    val missing: Int,
    val price: Double?,
    val missingCost: Double?,
    val reservedElsewhere: List<Reserved>,
)

data class CoverageTotals(
    val needed: Int, val owned: Int, val boxed: Int, val missing: Int,
    val missingCards: Int, val cost: Double, val unpriced: Int,
)

data class Coverage(val boxId: String?, val cards: List<CoverageCard>, val totals: CoverageTotals)

/**
 * Spec E1 §4/§5/§8 -- Abgleich eines Decks mit der Sammlung und die Texte dazu.
 * ZWILLING: desktop/src/utils/deckCoverage.js. Beide laufen gegen docs/fixtures/decks/coverage.json.
 * Wer eine Seite aendert, aendert beide.
 *
 * Ein Exemplar zaehlt nur, wenn es lebt UND sein Printing in [cards] steht (der Speicher fuehrt nur lebende
 * Printings; die JS-Fassung liest dafuer `printing_deleted`).
 */
object DeckCoverage {
    const val LOADING = "…"

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0

    /** Gueltige Deckbox = lebender Behaelter mit kind "deckbox". Geloescht oder umgestellt gilt als "keine Box". */
    fun validDeckboxIds(containers: List<ContainerRow>): Set<String> =
        containers.filter { !it.deleted && it.kind == "deckbox" }.mapTo(HashSet()) { it.containerId }

    /** Spec E1 §3: gueltige Deckboxen, die keinem ANDEREN Deck gehoeren, in der Reihenfolge der Behaelterliste. */
    fun deckBoxChoices(deckId: Long, decks: List<Deck>, containers: List<ContainerRow>): List<ContainerRow> {
        val taken = decks.filter { it.id != deckId }.mapNotNullTo(HashSet()) { it.containerId }
        return containers.filter { !it.deleted && it.kind == "deckbox" && it.containerId !in taken }
    }

    fun deckBoxId(deck: Deck, containers: List<ContainerRow>): String? =
        deck.containerId?.takeIf { it in validDeckboxIds(containers) }

    private class Acc(val cardId: String) {
        var needed = 0
        var inBox = 0
        var live = 0
        val reserved = LinkedHashMap<Long, Reserved>()
    }

    fun compute(
        deckId: Long,
        deckCards: List<DeckCard>,
        copies: List<CopyRow>,
        cards: List<CardRow>,
        decks: List<Deck>,
        containers: List<ContainerRow>,
        prices: Map<String, Double?>,
    ): Coverage {
        val valid = validDeckboxIds(containers)
        fun boxOf(d: Deck): String? = d.containerId?.takeIf { it in valid }
        val boxId = decks.firstOrNull { it.id == deckId }?.let { boxOf(it) }
        val otherBox = HashMap<String, Deck>()
        for (d in decks) {
            val b = boxOf(d)
            if (d.id != deckId && b != null) otherBox[b] = d
        }
        val liveKeys = cards.filter { !it.deleted }.mapTo(HashSet()) { it.printingKey() }

        val byCard = LinkedHashMap<String, Acc>()
        for (dc in deckCards) byCard.getOrPut(dc.cardId) { Acc(dc.cardId) }.needed += dc.count
        for (cp in copies) {
            if (cp.deleted || cp.printingKey() !in liveKeys) continue
            val e = byCard[cp.cardId] ?: continue
            e.live++
            val cid = cp.containerId
            if (boxId != null && cid == boxId) {
                e.inBox++
            } else if (cid != null) {
                val d = otherBox[cid] ?: continue
                val r = e.reserved[d.id] ?: Reserved(d.id, d.name, 0)
                e.reserved[d.id] = r.copy(count = r.count + 1)
            }
        }

        val deckOrder = decks.withIndex().associate { it.value.id to it.index }
        val out = ArrayList<CoverageCard>()
        var needed = 0; var owned = 0; var boxed = 0; var missingSum = 0
        var missingCards = 0; var cost = 0.0; var unpriced = 0
        for (e in byCard.values) {
            // Reihenfolge der Deckliste, damit beide Geraete die Markierungen gleich ordnen.
            val reserved = e.reserved.values.sortedBy { deckOrder[it.deckId] ?: Int.MAX_VALUE }
            val available = e.live - reserved.sumOf { it.count }
            val missing = maxOf(0, e.needed - available)
            val price = prices[e.cardId]?.takeIf { it > 0.0 }
            val missingCost = price?.let { round2(missing * it) }
            out.add(CoverageCard(e.cardId, e.needed, e.inBox, available, missing, price, missingCost, reserved))
            needed += e.needed
            owned += minOf(e.needed, available)
            boxed += minOf(e.needed, e.inBox)
            missingSum += missing
            if (missing > 0) {
                missingCards++
                if (missingCost == null) unpriced++ else cost += missingCost
            }
        }
        return Coverage(boxId, out, CoverageTotals(needed, owned, boxed, missingSum, missingCards, round2(cost), unpriced))
    }

    fun eur(v: Double): String = String.format(Locale.GERMANY, "%,.2f €", v)

    fun costText(t: CoverageTotals): String? = when {
        t.missing == 0 -> null
        t.unpriced == t.missingCards -> "Preis unbekannt"
        t.unpriced > 0 -> "ca. ${eur(t.cost)} + ${t.unpriced} ohne Preis"
        else -> "ca. ${eur(t.cost)}"
    }

    fun headerText(c: Coverage): String {
        val t = c.totals
        val cost = costText(t)?.let { " · $it" } ?: ""
        return "vorhanden ${t.owned}/${t.needed} · in der Box ${t.boxed}/${t.needed} · fehlen ${t.missing}$cost"
    }

    fun listText(c: Coverage): String {
        val t = c.totals
        val cost = costText(t)?.let { " · $it" } ?: ""
        return "${t.owned}/${t.needed} vorhanden$cost"
    }

    fun boxLabel(deck: Deck, containers: List<ContainerRow>): String {
        val id = deckBoxId(deck, containers) ?: return "keine Box"
        return containers.firstOrNull { it.containerId == id }?.name ?: "keine Box"
    }

    fun rowText(card: CoverageCard): String = "Box ${card.inBox} · verfügbar ${card.available} · gebraucht ${card.needed}"

    fun reservedTexts(card: CoverageCard): List<String> = card.reservedElsewhere.map { "${it.count} in Deck ${it.name}" }
}
