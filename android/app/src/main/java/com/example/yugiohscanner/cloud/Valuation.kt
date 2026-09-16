package com.example.yugiohscanner.cloud

import java.util.Locale

// Fixed condition factors — MUST equal desktop/electron/condition-factors.json (ValuationTest checks).
object Valuation {
    val CONDITIONS = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    val EDITIONS = listOf("first", "unlimited", "limited", "unknown")
    val EDITION_LABELS = mapOf("first" to "1st Ed", "unlimited" to "Unlimited", "limited" to "Limited", "unknown" to "Unbek.")
    private val FACTORS = mapOf("MT" to 1.0, "NM" to 1.0, "EX" to 0.85, "GD" to 0.7, "LP" to 0.5, "PL" to 0.35, "PO" to 0.2)

    fun factor(condition: String?): Double = FACTORS[condition?.uppercase() ?: ""] ?: 1.0

    /**
     * Spec G4 §6 -- Einzelpreis eines Exemplars: 1st-Ed-Preis fuer edition = "first", sonst Basispreis.
     * ZWILLING: desktop/electron/valuation.cjs (unitPrice/valueOf/unitPriceCaseSql) und desktop/src/utils/valuation.js.
     * Gemeinsame Fixture docs/fixtures/valuation/first-ed.json (ValuationTest). Wer eine Fassung aendert, aendert alle.
     */
    fun unitPrice(card: CardRow, copy: CopyRow): Double {
        val first = card.priceFirstEd
        return if (copy.edition == "first" && first != null) first else card.price ?: 0.0
    }

    /** Summe unitPrice x Zustandsfaktor ueber lebende Exemplare, auf Cent gerundet. */
    fun valueOf(card: CardRow, copies: List<CopyRow>): Double {
        if (copies.isEmpty()) return 0.0
        var v = 0.0
        for (c in copies) if (!c.deleted) v += unitPrice(card, c) * factor(c.condition)
        return Math.round(v * 100.0) / 100.0
    }

    /**
     * Spec G4 §7 -- Preiszeile "Basis … · 1st Ed … (×…)". ZWILLING: firstEdLine in desktop/src/utils/valuation.js.
     * Faktor vor dem Formatieren auf 2 Nachkommastellen runden (Math.round statt %.2f/HALF_UP) -- sonst rundet
     * dieselbe Zahl (z.B. 1.005) auf Desktop und Handy verschieden, weil beide Plattformen ihre eigene
     * Nachkomma-Rundung mitbringen.
     */
    fun firstEdLine(card: CardRow): String? {
        val first = card.priceFirstEd ?: return null
        val line = String.format(Locale.GERMANY, "Basis %,.2f € · 1st Ed %,.2f €", card.price ?: 0.0, first)
        val f = card.cmFirstEdFactor ?: return line
        val rounded = Math.round(f * 100.0) / 100.0
        return line + String.format(Locale.GERMANY, " (×%.2f)", rounded)
    }

    data class Group(val edition: String, val condition: String, val count: Int)

    fun group(copies: List<CopyRow>): List<Group> =
        copies.filter { !it.deleted }
            .groupBy { it.edition to it.condition }
            .map { (k, v) -> Group(k.first, k.second, v.size) }
            .sortedWith(compareBy({ EDITIONS.indexOf(it.edition) }, { CONDITIONS.indexOf(it.condition) }))
}
