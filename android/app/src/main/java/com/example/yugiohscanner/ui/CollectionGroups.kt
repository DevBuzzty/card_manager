package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.RarityQuellen
import androidx.compose.runtime.Immutable
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.CardFilterPresets
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.TagVocabulary
import com.example.yugiohscanner.ml.Tags

// One passcode grouped across all its owned printings. @Immutable: die Listen darin werden nach dem
// Bauen nie veraendert -- so kann Compose eine unveraenderte Zeile beim Scrollen ueberspringen.
@Immutable
internal data class CardGroup(
    val id: String,
    val name: String?,
    val imageUrl: String?,
    val totalQty: Int,
    val totalValue: Double,
    val maxPrice: Double,
    val rarities: List<String>,
    val variants: List<CardRow>,
    // Spec B1 §10.4: nur gesetzt, waehrend ein Behaelterfilter aktiv ist -- der vorformatierte
    // Standort-Chip-Text (CopyLocation.format) DES ERSTEN passenden Exemplars (siehe filterGroups
    // unten), nicht der Gruppe. Bereits hier statt erst beim Rendern aufgeloest, weil zu diesem
    // Zeitpunkt die Behaelterliste bereits vorliegt.
    val locationLabel: String? = null,
    // Spec H1 §5.3: Zusatz "(2 zum Verkauf)", sonst null.
    val saleNote: String? = null,
)

private fun groupCards(cards: List<CardRow>, byKey: Map<String, List<CopyRow>>): List<CardGroup> =
    cards.groupBy { it.id }.map { (id, rows) ->
        CardGroup(
            id = id,
            name = rows.firstOrNull()?.name,
            imageUrl = rows.firstOrNull { !it.imageUrl.isNullOrBlank() }?.imageUrl,
            totalQty = rows.sumOf { it.quantity },
            totalValue = rows.sumOf { printingValue(it, byKey) },
            maxPrice = rows.maxOfOrNull { it.price ?: 0.0 } ?: 0.0,
            rarities = rows.map { RarityQuellen.display(it.rarity) }.distinct(), // „2“/„3“/„New“ -> „Unbekannt“
            variants = rows.sortedByDescending { it.price ?: 0.0 },
        )
    }

/** Alles, was die Kartenliste setzt: Suche, Sortierung und Filter. Gleichheit per Inhalt (Merker-Schluessel). */
internal data class GroupFilter(
    val query: String = "",
    val sort: String = "total", // total | single | name
    val set: String? = null,
    val rarity: String? = null,
    val type: String? = null,
    val lang: String? = null,
    val condition: String? = null,
    val edition: String? = null,
    val containers: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val presets: List<String> = emptyList(),
)

/**
 * Was nur vom Speicherstand abhaengt (nicht von den Filtern): einmal je Stand gerechnet, damit ein
 * Tastendruck in der Suche nicht erneut ~8700 Karten gruppiert.
 */
internal class CollectionBase(
    val cards: List<CardRow>,
    val copies: List<CopyRow>,
    val containers: List<ContainerRow>,
) {
    val byKey: Map<String, List<CopyRow>> = copies.groupBy { it.printingKey() }
    val forSaleByCard: Map<String, Int> = copies.filter { !it.deleted && it.forSale }.groupingBy { it.cardId }.eachCount()
    val groups: List<CardGroup> = groupCards(cards, byKey)
    val tagOptions: List<String> = TagVocabulary.from(copies)
    val setOptions: List<String> = cards.map { it.setCode.substringBefore('-') }.distinct().sorted()
    val rarityOptions: List<String> = cards.map { RarityQuellen.display(it.rarity) }.distinct().sorted()
    val typeOptions: List<String> = cards.mapNotNull { it.type }.distinct().sorted()
    val langOptions: List<String> = cards.map { it.language }.distinct().sorted()
}

internal fun filterGroups(base: CollectionBase, f: GroupFilter): List<CardGroup> {
    val byKey = base.byKey
    fun copiesOfGroup(g: CardGroup): List<CopyRow> = g.variants.flatMap { byKey[it.printingKey()] ?: emptyList() }
    fun copyMatchesContainer(cp: CopyRow) = f.containers.isEmpty() || (cp.containerId != null && f.containers.contains(cp.containerId))
    fun copyMatchesTags(cp: CopyRow): Boolean {
        if (f.tags.isEmpty()) return true
        val copyTags = Tags.parse(cp.tags).map { it.lowercase() }
        return f.tags.any { copyTags.contains(it.lowercase()) }
    }

    val query = f.query
    val out = ArrayList<CardGroup>()
    for (g0 in base.groups) {
        // Spec B1 §10.4 Befund 1 (wie Task 7 am Desktop, CollectionList.jsx): die Textsuche
        // findet zusaetzlich Tags und Notizen der Exemplare -- ausschliesslich ueber
        // Tags.parse, kein eigenes Zerlegen der JSON-Spalte. Gleiche Entscheidungen wie
        // Desktop uebernommen: gross-/kleinschreibungsunabhaengig, Teiltreffer genuegt, keine
        // zusaetzliche Beschneidung des Suchbegriffs.
        if (query.isNotBlank() &&
            !((g0.name ?: "").contains(query, true) ||
                g0.variants.any { it.setCode.contains(query, true) } ||
                copiesOfGroup(g0).any { cp -> Tags.parse(cp.tags).any { it.contains(query, true) } } ||
                copiesOfGroup(g0).any { cp -> cp.note?.contains(query, true) == true })
        ) continue
        if (f.set != null && g0.variants.none { it.setCode.substringBefore('-') == f.set }) continue
        if (f.rarity != null && !g0.rarities.contains(f.rarity)) continue
        if (f.type != null && g0.variants.none { it.type == f.type }) continue
        if (f.lang != null && g0.variants.none { it.language == f.lang }) continue
        if (f.condition != null && g0.variants.none { v -> byKey[v.printingKey()]?.any { !it.deleted && it.condition == f.condition } == true }) continue
        if (f.edition != null && g0.variants.none { v -> byKey[v.printingKey()]?.any { !it.deleted && it.edition == f.edition } == true }) continue
        if (f.presets.isNotEmpty()) {
            val drucke = g0.variants.map { CardFilterPresets.Druck(it.setCode, it.rarity, it.price ?: 0.0) }
            if (f.presets.any { !CardFilterPresets.trifftGruppe(drucke, it) }) continue
        }

        // GRUPPIERUNGSFALLE (Spec B1 §10.4, wie Task 7 am Desktop): diese Liste gruppiert
        // nach Passcode (eine Gruppe kann mehrere Printings buendeln), Behaelter/Tag sitzen
        // aber am EXEMPLAR (card_copies). Eine Gruppe bleibt daher sichtbar, sobald
        // MINDESTENS EIN lebendes Exemplar eines ihrer Printings BEIDE aktiven Filter
        // ZUGLEICH erfuellt (nicht zwei verschiedene Exemplare je einen) -- der Chip unten
        // gehoert zu GENAU DIESEM Exemplar, nicht zur Gruppe. Liegen mehrere passende
        // Exemplare in verschiedenen Behaeltern, zeigt die Zeile bewusst nur das erste.
        var locationLabel: String? = null
        if (f.containers.isNotEmpty() || f.tags.isNotEmpty()) {
            val match = copiesOfGroup(g0).firstOrNull { copyMatchesContainer(it) && copyMatchesTags(it) } ?: continue
            if (f.containers.isNotEmpty()) {
                locationLabel = CopyLocation.format(match, base.containers.find { it.containerId == match.containerId })
            }
        }
        out.add(g0.copy(locationLabel = locationLabel, saleNote = Duplicates.forSaleSuffix(base.forSaleByCard[g0.id] ?: 0)))
    }
    return out.sortedWith(
        when (f.sort) {
            "name" -> compareBy { it.name ?: it.id }
            "single" -> compareByDescending { it.maxPrice }
            else -> compareByDescending { it.totalValue }
        }
    )
}

/**
 * Performance (Seitenwechsel): prozessweiter Merker wie DashboardMemo. Die Basis gilt je Speicherstand
 * (Listen per Identitaet), das gefilterte Ergebnis je Basis und Filter (per Inhalt). Beim Wiederkommen
 * in die Sammlung liefert [peek] sofort das letzte Ergebnis; gerechnet wird nur in [get], und das ruft
 * die Oberflaeche abseits des Hauptthreads auf.
 */
internal object CollectionGroupsMemo {
    private val lock = Any()
    private var base: CollectionBase? = null
    private var lastFilter: GroupFilter? = null
    private var lastGroups: List<CardGroup>? = null

    private fun baseHit(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): CollectionBase? =
        base?.takeIf { it.cards === cards && it.copies === copies && it.containers === containers }

    fun peekBase(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): CollectionBase? =
        synchronized(lock) { baseHit(cards, copies, containers) }

    fun peek(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>, filter: GroupFilter): List<CardGroup>? =
        synchronized(lock) { if (baseHit(cards, copies, containers) != null && lastFilter == filter) lastGroups else null }

    fun base(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): CollectionBase {
        synchronized(lock) { baseHit(cards, copies, containers)?.let { return it } }
        val b = CollectionBase(cards, copies, containers)
        synchronized(lock) {
            base = b
            lastFilter = null
            lastGroups = null
        }
        return b
    }

    fun get(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>, filter: GroupFilter): List<CardGroup> {
        peek(cards, copies, containers, filter)?.let { return it }
        val b = base(cards, copies, containers)
        val groups = filterGroups(b, filter)
        synchronized(lock) {
            if (base === b) {
                lastFilter = filter
                lastGroups = groups
            }
        }
        return groups
    }
}
