package com.example.yugiohscanner.ml

/** Ergebnis einer Eingabe. value null und error null heisst "leer" (nur beim Zielpreis erlaubt: entfernen). */
data class AlertParse(val value: Double?, val error: String?)

/**
 * Spec G2 §7/§9 -- Eingabepruefung der Preis-Alarme (deutsches Komma, kein Tausenderpunkt).
 * ZWILLING: desktop/src/utils/alertInput.js. Beide laufen gegen docs/fixtures/portfolio/alert-input.json.
 * Wer eine Seite aendert, aendert beide.
 */
object AlertInput {
    private val EURO = Regex("""^\d+([.,]\d{1,2})?$""")
    private val PCT = Regex("""^\d+([.,]\d)?$""")

    private fun num(t: String): Double = t.replace(',', '.').toDouble()

    fun parseTarget(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (t.isEmpty()) return AlertParse(null, null)
        if (!EURO.matches(t)) return AlertParse(null, "Ungültiger Betrag")
        val v = num(t)
        return if (v > 0) AlertParse(v, null) else AlertParse(null, "Betrag muss größer als 0 sein")
    }

    fun parsePct(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (!PCT.matches(t)) return AlertParse(null, "Ungültige Zahl")
        val v = num(t)
        return if (v in 1.0..500.0) AlertParse(v, null) else AlertParse(null, "Prozent zwischen 1 und 500")
    }

    fun parseMinEur(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (!EURO.matches(t)) return AlertParse(null, "Ungültiger Betrag")
        return AlertParse(num(t), null)
    }

    /** Wie JS String(Number(v)): 2.0 -> "2", 12.5 -> "12,5", null -> "". */
    fun toInput(v: Double?): String {
        if (v == null) return ""
        val s = if (v == Math.floor(v) && Math.abs(v) < 1e15) v.toLong().toString() else v.toString()
        return s.replace('.', ',')
    }
}
