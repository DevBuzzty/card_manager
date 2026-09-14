package com.example.yugiohscanner.ml

data class StepPoint(val day: String, val price: Double)
data class StepMarker(val day: String, val family: String)
data class Steps(
    val kind: String,
    val flatDay: String? = null,
    val flatPrice: Double? = null,
    val points: List<StepPoint> = emptyList(),
    val markers: List<StepMarker> = emptyList(),
)

/**
 * Spec G1 §4.5 -- Stufenlinie des Preisverlaufs.
 * ZWILLING: desktop/src/utils/priceSteps.js. Beide laufen gegen docs/fixtures/portfolio/price-steps.json.
 * Wer eine Seite aendert, aendert beide.
 */
object PriceSteps {
    fun compute(rows: List<PriceRef>, today: String, windowDays: Int): Steps {
        val sorted = rows.sortedBy { it.day }
        if (sorted.isEmpty()) return Steps("none")
        if (sorted.size == 1) return Steps("flat", flatDay = sorted[0].day, flatPrice = sorted[0].price)
        val start = UtcDay.add(today, -windowDays)
        val points = ArrayList<StepPoint>()
        val markers = ArrayList<StepMarker>()
        var before: PriceRef? = null
        for (i in sorted.indices) {
            val r = sorted[i]
            if (r.day < start) { before = r; continue }
            if (r.day > today) continue
            val b = before
            if (points.isEmpty() && b != null && r.day != start) points += StepPoint(start, b.price)
            points += StepPoint(r.day, r.price)
            if (i > 0) {
                val prevFam = PriceFamily.ofSource(sorted[i - 1].source)
                val fam = PriceFamily.ofSource(r.source)
                if (prevFam != fam) markers += StepMarker(r.day, fam)
            }
        }
        val b = before
        if (points.isEmpty() && b != null) points += StepPoint(start, b.price)
        val last = points.lastOrNull()
        if (last != null && last.day != today) points += StepPoint(today, last.price)
        return Steps("series", points = points, markers = markers)
    }
}
