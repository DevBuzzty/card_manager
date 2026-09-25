package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class Mover(
    val key: String, val card: CardRow,
    val oldPrice: Double, val newPrice: Double, val deltaUnit: Double, val pct: Double?,
    val weight: Double, val copies: Int, val deltaHolding: Double,
)

data class MoversResult(val status: String, val firstDay: String?, val winners: List<Mover>, val losers: List<Mover>)

/**
 * Spec G1 §4.2 -- was als Bewegung zaehlt.
 * ZWILLING: desktop/electron/movers.cjs. Beide laufen gegen docs/fixtures/portfolio/movers.json.
 * Wer eine Seite aendert, aendert beide.
 */
object Movers {
    /** Unter diesem alten Preis (EUR) kein Prozentwert (0,02 -> 1,00 EUR waeren +4900 %). ZWILLING: movers.cjs#PCT_MIN_BASE. */
    const val PCT_MIN_BASE = 0.1

    private fun round(x: Double, f: Double): Double = Math.round(x * f).toDouble() / f

    private fun better(a: PriceRef?, b: PriceRef, cutoff: String): PriceRef {
        if (a == null) return b
        val aIn = a.day <= cutoff
        val bIn = b.day <= cutoff
        if (aIn != bIn) return if (aIn) a else b
        return if (aIn) { if (b.day > a.day) b else a } else { if (b.day < a.day) b else a }
    }

    fun compute(
        cards: List<CardRow>, copies: List<CopyRow>, references: List<PriceRef>,
        today: String, days: Int, top: Int = 10,
    ): MoversResult {
        val cutoff = UtcDay.add(today, -days)

        val weight = HashMap<String, Double>()
        val count = HashMap<String, Int>()
        for (c in copies) {
            if (c.deleted) continue
            val k = c.printingKey()
            weight[k] = (weight[k] ?: 0.0) + Valuation.factor(c.condition)
            count[k] = (count[k] ?: 0) + 1
        }

        val refs = HashMap<String, PriceRef>()
        for (r in references) refs[r.key()] = better(refs[r.key()], r, cutoff)

        var hasReference = false
        var firstDay: String? = null
        val movers = ArrayList<Mover>()
        for (c in cards) {
            if (c.deleted) continue
            val k = c.printingKey()
            val w = weight[k] ?: continue
            val ref = refs[k] ?: continue
            if (ref.day > cutoff) {
                val d = UtcDay.add(ref.day, days)
                if (firstDay == null || d < firstDay) firstDay = d
                continue
            }
            hasReference = true
            val oldPrice = ref.price
            val newPrice = c.price ?: 0.0
            if (newPrice <= 0.0 || oldPrice <= 0.0) continue
            val fam = PriceFamily.ofSource(ref.source)
            if (fam != PriceFamily.ofLock(c.priceLocked) || fam == "manual" || fam == "unknown") continue
            val deltaUnit = round(newPrice - oldPrice, 100.0)
            if (deltaUnit == 0.0) continue
            movers += Mover(
                key = k, card = c, oldPrice = oldPrice, newPrice = newPrice, deltaUnit = deltaUnit,
                pct = if (oldPrice < PCT_MIN_BASE) null else round((newPrice - oldPrice) / oldPrice * 100.0, 10.0),
                weight = round(w, 100.0), copies = count[k] ?: 0,
                deltaHolding = round((newPrice - oldPrice) * w, 100.0),
            )
        }

        val winners = movers.filter { it.deltaHolding > 0.0 }
            .sortedWith(compareByDescending<Mover> { it.deltaHolding }.thenBy { it.key }).take(top)
        val losers = movers.filter { it.deltaHolding < 0.0 }
            .sortedWith(compareBy<Mover> { it.deltaHolding }.thenBy { it.key }).take(top)
        val status = if (hasReference) "ok" else "no_reference"
        return MoversResult(status, if (status == "no_reference") firstDay else null, winners, losers)
    }
}
