package com.example.yugiohscanner.ui

import java.util.Locale

/**
 * Spec 2026-10-04 §3.3 -- Preis eines Drucks auf der Ergebnis-Seite, feste Reihenfolge:
 * eigener Druck mit Preis > 0 > eindeutige Cardmarket-Nummer mit Trend > Spanne der moeglichen
 * Nummern > keiner. Fixture: docs/fixtures/druck-preis.json.
 */
object DruckPreis {
    sealed interface Preis
    data class Fest(val eur: Double, val ausSammlung: Boolean) : Preis
    data class Spanne(val min: Double, val max: Double) : Preis
    object Keiner : Preis

    fun fuer(eigenerPreis: Double?, cm: List<Int>, trend: (Int) -> Double?): Preis {
        if (eigenerPreis != null && eigenerPreis > 0) return Fest(eigenerPreis, ausSammlung = true)
        val werte = cm.mapNotNull(trend).filter { it > 0 }
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        return if (min == max) Fest(min, ausSammlung = false) else Spanne(min, max)
    }

    /** Kopfpreis bei unsicherer Erkennung: Spanne ueber die moeglichen Drucke. */
    fun spanneUeber(preise: List<Preis>): Preis {
        val werte = preise.flatMap { p -> when (p) { is Fest -> listOf(p.eur); is Spanne -> listOf(p.min, p.max); Keiner -> emptyList() } }
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        return if (min == max) Fest(min, ausSammlung = false) else Spanne(min, max)
    }

    private fun eur(v: Double) = String.format(Locale.GERMANY, "%.2f", v)

    fun text(p: Preis): String = when (p) {
        is Fest -> "${eur(p.eur)} €"
        is Spanne -> "ca. ${eur(p.min)}–${eur(p.max)} €"
        Keiner -> "–"
    }
}
