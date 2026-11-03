package com.example.yugiohscanner.ui

import java.util.Locale

/**
 * Spec 2026-11-03 §2.1/§2.4 (vorher Spec 2026-10-04 §3.3) -- Preis eines Drucks auf der Ergebnis-Seite, feste
 * Reihenfolge: eigener Druck mit Preis > 0 > eindeutiges Katalog-Produkt mit Trend > eindeutige Live-Zuordnung mit
 * Trend > mehrere Versionen (Katalog vor Live) > keiner. Fixture: docs/fixtures/druck-preis.json.
 * Der Richtwert ("ab …", guenstigster Druck der Karte, §7) gibt es nur im Kopf, nie je Druck, nie in Valuation.
 */
object DruckPreis {
    enum class Quelle { SAMMLUNG, TREND, LIVE }

    sealed interface Preis
    /** [mehrdeutig]: mehrere Cardmarket-Versionen, nur ein Wert bekannt -> nicht druckgenau, Text "ca. …". */
    data class Fest(val eur: Double, val quelle: Quelle, val mehrdeutig: Boolean = false) : Preis {
        val ausSammlung get() = quelle == Quelle.SAMMLUNG
    }
    data class Spanne(val min: Double, val max: Double, val quellen: Set<Quelle> = setOf(Quelle.TREND)) : Preis
    /** Nur Kopf (§2.2): kartenweiter Cardmarket-Wert; [ausKatalog] = CatalogCard.cmPrice, sonst Live-Antwort. */
    data class Richtwert(val eur: Double, val ausKatalog: Boolean) : Preis
    object Keiner : Preis

    /**
     * [liveCm] ist fuer nicht-europaeische Zeilen immer leer (dafuer sorgt ScanErgebnis.drucke). Spec §2.1:
     * Stufe 3 (eindeutig live) steht vor Stufe 4 (Arrays), eine eindeutige Katalog-ID mit Trend schlaegt jede Live-Antwort.
     */
    fun fuer(eigenerPreis: Double?, cm: List<Int>, liveCm: List<Int>, trend: (Int) -> Double?): Preis {
        if (eigenerPreis != null && eigenerPreis > 0) return Fest(eigenerPreis, Quelle.SAMMLUNG)
        fun t(id: Int) = trend(id)?.takeIf { it > 0 }
        if (cm.size == 1) t(cm[0])?.let { return Fest(it, Quelle.TREND) }
        if (liveCm.size == 1) t(liveCm[0])?.let { return Fest(it, Quelle.LIVE) }
        val (basis, q) = when {
            cm.size >= 2 -> cm to Quelle.TREND
            liveCm.size >= 2 -> liveCm to Quelle.LIVE
            else -> return Keiner
        }
        val werte = basis.mapNotNull(::t)
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        if (min != max) return Spanne(min, max, setOf(q))
        return Fest(min, q, mehrdeutig = werte.size < basis.size)
    }

    /**
     * Spec §2.2 -- Kopfpreis ueber mehrere Drucke. Ignoriert Richtwert und Keiner. Ein Wert -> Fest mit der gemeinsamen
     * Quelle (sonst TREND), mehrdeutig, wenn ein Beitrag es war oder (Review-Nachtrag 2) nicht jeder der beteiligten
     * Drucke einen Wert hatte -- wie Stufe 4 von [fuer]; sonst Spanne mit der Vereinigung der Quellen.
     */
    fun spanneUeber(preise: List<Preis>): Preis {
        val werte = ArrayList<Double>()
        val quellen = LinkedHashSet<Quelle>()
        var gemeinsam: Quelle? = null
        var einig = true
        var mehrdeutig = false
        var ohneWert = 0
        fun quelle(q: Quelle?) {
            if (q == null) { einig = false; return }
            if (gemeinsam == null) gemeinsam = q else if (gemeinsam != q) einig = false
        }
        for (p in preise) when (p) {
            is Fest -> { werte += p.eur; quellen += p.quelle; quelle(p.quelle); if (p.mehrdeutig) mehrdeutig = true }
            is Spanne -> { werte += p.min; werte += p.max; quellen += p.quellen; quelle(p.quellen.singleOrNull()) }
            is Richtwert, Keiner -> ohneWert++
        }
        if (werte.isEmpty()) return Keiner
        val min = werte.min(); val max = werte.max()
        if (min != max) return Spanne(min, max, quellen)
        return Fest(min, if (einig) gemeinsam ?: Quelle.TREND else Quelle.TREND, mehrdeutig || ohneWert > 0)
    }

    fun eur(v: Double): String = String.format(Locale.GERMANY, "%.2f", v)

    fun text(p: Preis): String = when (p) {
        is Fest -> (if (p.mehrdeutig) "ca. " else "") + "${eur(p.eur)} €"
        is Spanne -> "ca. ${eur(p.min)}–${eur(p.max)} €"
        is Richtwert -> "ab ${eur(p.eur)} €"
        Keiner -> "–"
    }
}
