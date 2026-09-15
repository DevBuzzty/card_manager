package com.example.yugiohscanner.ml

import kotlin.math.abs

/**
 * Spec G2 §8 -- Treffertexte der Preis-Alarme.
 * ZWILLING: desktop/electron/alert-text.cjs. Beide laufen gegen docs/fixtures/portfolio/alert-texts.json.
 * Wer eine Seite aendert, aendert beide. Gerechnet wird in ganzen Cent bzw. Zehntelprozent.
 */
object AlertText {
    private const val MINUS = "−"

    fun eur(value: Double): String {
        val cents = Math.round(abs(value) * 100)
        val int = (cents / 100).toString().reversed().chunked(3).joinToString(".").reversed()
        val frac = (cents % 100).toString().padStart(2, '0')
        return "${if (value < 0 && cents > 0) MINUS else ""}$int,$frac €"
    }

    fun signedPct(value: Double): String {
        val tenths = Math.round(abs(value) * 10)
        return "${if (value < 0) MINUS else "+"}${tenths / 10},${tenths % 10} %"
    }

    // Gespeichertes "Unknown" oder leer erscheint als "Unbekannt" (Spec G1 §4.12).
    private fun label(v: String?): String = if (v.isNullOrBlank() || v == "Unknown") "Unbekannt" else v

    fun of(
        kind: String, name: String?, cardId: String, setCode: String?, rarity: String?,
        oldPrice: Double?, newPrice: Double, pct: Double?, days: Int?, threshold: Double?,
    ): String {
        val head = "${name?.takeIf { it.isNotEmpty() } ?: cardId} · ${label(setCode)} · ${label(rarity)}"
        if (kind == "move") {
            val old = oldPrice?.let { eur(it) } ?: "—"
            return "$head: ${signedPct(pct ?: 0.0)} in $days Tagen ($old → ${eur(newPrice)})"
        }
        val op = if (kind == "above") "≥" else "≤"
        return "$head: Zielpreis $op ${eur(threshold ?: 0.0)} erreicht (${eur(newPrice)})"
    }
}
