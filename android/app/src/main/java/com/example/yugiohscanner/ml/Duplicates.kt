package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import java.util.Locale

/** Ein lebendes Exemplar mit seinem Printing (Preis, 1.-Auflage-Preis, Name, Bild); card null = Printing fehlt, Preis 0. */
data class SaleCopy(val copy: CopyRow, val card: CardRow?)

/** Ein Duplikat-Eintrag je Haupt-Passcode; copyIds = Vorschlag in Sortierreihenfolge, value = Wert des Vorschlags. */
data class DuplicateEntry(val mainId: String, val count: Int, val surplus: Int, val copyIds: List<String>, val value: Double)

data class DuplicatesSummary(val cards: Int, val copies: Int, val value: Double)

data class ForSaleSummary(val copies: Int, val value: Double)

/** Ein Printing der Verkaufsliste mit seinen markierten Exemplaren (nach created_at, dann copy_id). */
data class ForSaleGroup(
    val cardId: String, val setCode: String, val language: String, val rarity: String, val name: String?, val copyIds: List<String>,
)

data class ToggleTargets(val ids: List<String>, val value: Boolean)

/**
 * Spec H1 §4/§5 -- Duplikate (Überschuss über keep_per_card je Haupt-Passcode, Vorschlag), Verkaufsliste und die Texte dazu.
 * ZWILLING: desktop/src/utils/duplicates.js. Beide laufen gegen docs/fixtures/duplicates/duplicates.json.
 * Wer eine Seite aendert, aendert beide. Wert je Exemplar = Valuation.unitPrice x Zustandsfaktor (Wertanzeige-Formel).
 */
object Duplicates {
    const val KEEP_DEFAULT = 3
    const val LOADING = "…"

    /** Schlechtester Zustand zuerst; ein unbekannter Zustand ordnet wie NM. */
    private val CONDITION_RANK = listOf("PO", "PL", "LP", "GD", "EX", "NM", "MT")
    private val KEEP_RE = Regex("(?U)^\\s*([0-9]{1,2})\\s*$")
    private val BLANK_RE = Regex("(?U)^\\s*$")

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0
    private fun rank(condition: String): Int = CONDITION_RANK.indexOf(condition).let { if (it < 0) CONDITION_RANK.indexOf("NM") else it }
    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

    /** Einstellung keep_per_card: ganze Zahl 1–99, alles andere -> 3. */
    fun keepPerCard(raw: String?): Int {
        val m = KEEP_RE.find(raw ?: "") ?: return KEEP_DEFAULT
        val n = m.groupValues[1].toInt()
        return if (n in 1..99) n else KEEP_DEFAULT
    }

    /** Standort, Tags oder Notiz gesetzt; leere Werte zaehlen wie nicht gesetzt. */
    fun hasPlace(c: CopyRow): Boolean =
        !c.containerId.isNullOrEmpty() || Tags.parse(c.tags).isNotEmpty() || (c.note != null && !BLANK_RE.matches(c.note))

    private fun unitPrice(s: SaleCopy): Double = s.card?.let { Valuation.unitPrice(it, s.copy) } ?: 0.0

    /** Wert eines Exemplars (ungerundet); ohne Preis 0. */
    fun unitValue(s: SaleCopy): Double = unitPrice(s) * Valuation.factor(s.copy.condition)

    private fun flag(b: Boolean) = if (b) 1 else 0

    /** Stabile Vorschlags-Reihenfolge (Kriterien 1–6); zuletzt copy_id, damit beide Geraete gleich ordnen. */
    private val PROPOSAL_ORDER = Comparator<SaleCopy> { a, b ->
        var r = flag(b.copy.forSale) - flag(a.copy.forSale)
        if (r == 0) r = flag(hasPlace(a.copy)) - flag(hasPlace(b.copy))
        if (r == 0) r = flag(a.copy.edition == "first") - flag(b.copy.edition == "first")
        if (r == 0) r = rank(a.copy.condition) - rank(b.copy.condition)
        if (r == 0) r = unitPrice(a).compareTo(unitPrice(b))
        if (r == 0) r = (b.copy.createdAt ?: "").compareTo(a.copy.createdAt ?: "")
        if (r == 0) r = a.copy.copyId.compareTo(b.copy.copyId)
        r
    }

    /**
     * [copies]: Exemplare (geloeschte werden uebersprungen); [keep]: roh; [mainIdOf]: Passcode -> Haupt-Passcode (null = ohne
     * Katalog). Nur Karten mit Überschuss, sortiert nach Überschuss, dann Wert (beide absteigend), dann Haupt-Passcode.
     */
    fun duplicates(copies: List<SaleCopy>, keep: String?, mainIdOf: ((String) -> String?)?): List<DuplicateEntry> {
        val k = keepPerCard(keep)
        val groups = LinkedHashMap<String, MutableList<SaleCopy>>()
        for (s in copies) {
            if (s.copy.deleted) continue
            val stored = s.copy.cardId
            val mapped = mainIdOf?.invoke(stored)
            val id = if (mapped.isNullOrEmpty()) stored else mapped
            groups.getOrPut(id) { ArrayList() }.add(s)
        }
        val out = ArrayList<DuplicateEntry>()
        for ((id, list) in groups) {
            val surplus = maxOf(0, list.size - k)
            if (surplus == 0) continue
            val pick = list.sortedWith(PROPOSAL_ORDER).take(surplus)
            out.add(DuplicateEntry(id, list.size, surplus, pick.map { it.copy.copyId }, round2(pick.sumOf { unitValue(it) })))
        }
        return out.sortedWith(compareByDescending<DuplicateEntry> { it.surplus }.thenByDescending { it.value }.thenBy { it.mainId })
    }

    fun summary(list: List<DuplicateEntry>) = DuplicatesSummary(list.size, list.sumOf { it.surplus }, round2(list.sumOf { it.value }))

    fun forSaleSummary(copies: List<SaleCopy>): ForSaleSummary {
        val marked = copies.filter { !it.copy.deleted && it.copy.forSale }
        return ForSaleSummary(marked.size, round2(marked.sumOf { unitValue(it) }))
    }

    /** Verkaufsliste nach Printing, sortiert nach Name, Set-Code, Sprache, Seltenheit (Codeeinheiten wie in JS), Passcode. */
    fun forSaleGroups(copies: List<SaleCopy>): List<ForSaleGroup> {
        val groups = LinkedHashMap<String, MutableList<SaleCopy>>()
        for (s in copies) {
            if (s.copy.deleted || !s.copy.forSale) continue
            groups.getOrPut(s.copy.printingKey()) { ArrayList() }.add(s)
        }
        return groups.values.map { list ->
            val c = list.first().copy
            ForSaleGroup(
                c.cardId, c.setCode, c.language, c.rarity, list.first().card?.name,
                list.map { it.copy }.sortedWith(compareBy<CopyRow> { it.createdAt ?: "" }.thenBy { it.copyId }).map { it.copyId },
            )
        }.sortedWith(
            compareBy<ForSaleGroup> { it.name ?: "" }.thenBy { it.setCode }.thenBy { it.language }.thenBy { it.rarity }.thenBy { it.cardId },
        )
    }

    fun euroCents(v: Double): String = String.format(Locale.GERMANY, "%,.2f €", round2(v))
    fun euroWhole(v: Double): String = String.format(Locale.GERMANY, "%,d €", Math.round(v))

    fun headerText(s: DuplicatesSummary) =
        "${plural(s.cards, "Karte", "Karten")} · ${plural(s.copies, "Exemplar", "Exemplare")} über Playset · ca. ${euroWhole(s.value)}"
    fun confirmAllText(s: DuplicatesSummary) = "${plural(s.copies, "Exemplar", "Exemplare")} von ${plural(s.cards, "Karte", "Karten")} markieren?"
    fun rowCountText(e: DuplicateEntry) = "${plural(e.count, "Exemplar", "Exemplare")} · ${e.surplus} über Playset"

    /** Vorschlag in Worten, je Set-Code/Seltenheit/Zustand/Edition gezaehlt, in Vorschlagsreihenfolge. */
    fun proposalTexts(e: DuplicateEntry, byId: Map<String, SaleCopy>): List<String> {
        val groups = LinkedHashMap<List<String>, Pair<Int, CopyRow>>()
        for (id in e.copyIds) {
            val c = byId[id]?.copy ?: continue
            val key = listOf(c.setCode, c.rarity, c.condition, c.edition)
            val g = groups[key]
            groups[key] = if (g == null) 1 to c else (g.first + 1) to g.second
        }
        return groups.values.map { (n, c) -> "$n× ${c.setCode} ${c.rarity} · ${c.condition} · ${Valuation.EDITION_LABELS[c.edition] ?: c.edition}" }
    }

    fun forSaleHeaderText(s: ForSaleSummary) = "${plural(s.copies, "Exemplar", "Exemplare")} · ${euroCents(s.value)}"
    fun startSaleText(s: ForSaleSummary) = "Zum Verkauf: ${plural(s.copies, "Exemplar", "Exemplare")} · ${euroWhole(s.value)}"
    fun startDuplicatesText(s: DuplicatesSummary) = "Duplikate: ${plural(s.cards, "Karte", "Karten")}"
    fun saleShareText(s: ForSaleSummary) = "davon zum Verkauf: ${euroWhole(s.value)}"
    fun forSaleSuffix(n: Int): String? = if (n > 0) "($n zum Verkauf)" else null
    fun copyValueText(s: SaleCopy): String = if (unitPrice(s) > 0) euroCents(unitValue(s)) else "—"

    /** Spec H1 §5.4: "An" = alle Vorschlaege markiert. */
    fun toggleIsOn(e: DuplicateEntry, forSaleIds: Set<String>) = e.copyIds.isNotEmpty() && e.copyIds.all { it in forSaleIds }
    /** Beim Einschalten merken: diese Vorschlaege waren schon vorher markiert. */
    fun premarkedIds(e: DuplicateEntry, forSaleIds: Set<String>) = e.copyIds.filter { it in forSaleIds }
    /** An: alle Vorschlaege auf true. Aus: alle ausser den vorher markierten ([premarked] null = keine Vorgeschichte). */
    fun toggleTargets(e: DuplicateEntry, on: Boolean, premarked: List<String>?): ToggleTargets =
        if (on) ToggleTargets(e.copyIds.toList(), true)
        else (premarked ?: emptyList()).toSet().let { keep -> ToggleTargets(e.copyIds.filter { it !in keep }, false) }
    /** "Alle Vorschläge auf die Verkaufsliste": alle vorgeschlagenen, noch nicht markierten Exemplare. */
    fun allProposalIds(list: List<DuplicateEntry>, forSaleIds: Set<String>) = list.flatMap { it.copyIds }.filter { it !in forSaleIds }

    /** Exemplare des Speichers mit ihrem Printing; wie am Desktop (JOIN) nur lebende Exemplare lebender Printings. */
    fun saleCopies(copies: List<CopyRow>, cards: List<CardRow>): List<SaleCopy> {
        val byKey = cards.filter { !it.deleted }.associateBy { it.printingKey() }
        return copies.mapNotNull { c -> if (c.deleted) null else byKey[c.printingKey()]?.let { SaleCopy(c, it) } }
    }

    /**
     * Spec H1 I1: welcher Stand angezeigt wird. "…" (LOADING, current == null) nur, bis das erste
     * Ergebnis da ist; danach bleibt der zuletzt berechnete Stand sichtbar, auch wenn cards/copies/keep
     * sich schon geaendert haben und neu gerechnet wird -- Mutationen lesen ohnehin ueber
     * freshSaleData(), nie ueber den Kompositions-Schnappschuss. Nur ohne bereiten Speicher (storeReady
     * = false) wird der Platzhalter erzwungen.
     */
    fun <T> visibleSaleData(storeReady: Boolean, current: T?): T? = if (storeReady) current else null
}
