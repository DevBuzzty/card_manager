package com.example.yugiohscanner.cloud

// Fixed condition factors — MUST equal desktop/electron/condition-factors.json (ValuationTest checks).
object Valuation {
    val CONDITIONS = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    val EDITIONS = listOf("first", "unlimited", "limited", "unknown")
    val EDITION_LABELS = mapOf("first" to "1st Ed", "unlimited" to "Unlimited", "limited" to "Limited", "unknown" to "Unbek.")
    private val FACTORS = mapOf("MT" to 1.0, "NM" to 1.0, "EX" to 0.85, "GD" to 0.7, "LP" to 0.5, "PL" to 0.35, "PO" to 0.2)

    fun factor(condition: String?): Double = FACTORS[condition?.uppercase() ?: ""] ?: 1.0

    fun valueOf(price: Double?, copies: List<CopyRow>): Double {
        val p = price ?: 0.0
        if (p <= 0.0 || copies.isEmpty()) return 0.0
        val f = copies.filter { !it.deleted }.sumOf { factor(it.condition) }
        return Math.round(p * f * 100.0) / 100.0
    }

    data class Group(val edition: String, val condition: String, val count: Int)

    fun group(copies: List<CopyRow>): List<Group> =
        copies.filter { !it.deleted }
            .groupBy { it.edition to it.condition }
            .map { (k, v) -> Group(k.first, k.second, v.size) }
            .sortedWith(compareBy({ EDITIONS.indexOf(it.edition) }, { CONDITIONS.indexOf(it.condition) }))
}
