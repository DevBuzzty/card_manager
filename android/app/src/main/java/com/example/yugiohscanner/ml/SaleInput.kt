package com.example.yugiohscanner.ml

import java.time.LocalDate

/**
 * Spec H2 §5.2/§5.5 -- Eingabefelder des Buchungs-Sheets am Handy (SaleSheet.kt).
 * Geldbetraege mit Komma oder Punkt ("12,50", "12.5", "3"), hoechstens zwei Nachkommastellen,
 * nie negativ. Leer = nicht erfasst (null). Das PC-Gegenstueck (SaleDialog.jsx#parse/#toInput)
 * ist kein Zwilling im Sinne der Fixture: dort prueft das Zahlenfeld selbst, hier dieser Helfer.
 */
object SaleInput {
    private val MONEY = Regex("^[0-9]{1,7}([.,][0-9]{1,2})?$")
    private val DATE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")

    /** Betrag in Euro; null bei leerer ODER ungueltiger Eingabe -- ob gueltig, sagt [moneyOk]. */
    fun parseMoney(raw: String?): Double? {
        val s = raw?.trim() ?: return null
        if (!MONEY.matches(s)) return null
        return s.replace(',', '.').toDouble()
    }

    /** Leere Eingabe ist gueltig, wenn das Feld nicht [required] ist; sonst muss es ein Betrag >= 0 sein. */
    fun moneyOk(raw: String?, required: Boolean): Boolean {
        val s = raw?.trim() ?: ""
        if (s.isEmpty()) return !required
        return MONEY.matches(s)
    }

    /** Vorbelegung eines Geldfelds aus Cent, deutsches Komma ("12,50"). */
    fun centsInput(cents: Long): String {
        val abs = Math.abs(cents)
        val txt = "${abs / 100},${"%02d".format(java.util.Locale.ROOT, abs % 100)}"
        return if (cents < 0) "-$txt" else txt
    }

    private val PERCENT = Regex("^[0-9]{1,3}([.,][0-9]{1,2})?$")

    /** Kanalgebuehr in Prozent mit Komma oder Punkt, 0..100; leer = 0; ungueltig = null. */
    fun parsePercent(raw: String?): Double? {
        val s = raw?.trim() ?: ""
        if (s.isEmpty()) return 0.0
        if (!PERCENT.matches(s)) return null
        val v = s.replace(',', '.').toDouble()
        return if (v <= 100.0) v else null
    }

    /** JJJJ-MM-TT und ein echtes Kalenderdatum. */
    fun dateOk(raw: String?): Boolean {
        val s = raw?.trim() ?: return false
        if (!DATE.matches(s)) return false
        return runCatching { LocalDate.parse(s) }.isSuccess
    }
}
