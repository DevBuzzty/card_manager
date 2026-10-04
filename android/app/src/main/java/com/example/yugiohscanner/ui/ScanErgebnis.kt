package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogPrinting
import com.example.yugiohscanner.cloud.SetOption
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Spec 2026-10-04 §4 -- reine Logik der Ergebnis-Seite (Compose-frei, unit-getestet). */
object ScanErgebnis {
    data class Druck(
        val setCode: String, val rarity: String, val language: String,
        val cm: List<Int>, val anzahl: Int, val preis: DruckPreis.Preis, val eigeneZeile: CardRow?,
    )

    fun key(setCode: String, rarity: String, language: String) =
        "${setCode.uppercase()}|${rarity.lowercase()}|${language.uppercase()}"

    /** Alle Drucke der Karte: erst die bekannten (Katalog-Reihenfolge), dann eigene, die fehlen. KR nie mit Cardmarket. */
    fun drucke(known: List<SetOption>, katalog: List<CatalogPrinting>, besitz: List<CardRow>, trend: (Int) -> Double?): List<Druck> {
        val out = LinkedHashMap<String, Druck>()
        fun nimm(code: String, rarity: String, lang: String) {
            val k = key(code, rarity, lang)
            if (k in out) return
            val eigen = besitz.filter {
                it.setCode.equals(code, true) && (it.rarity ?: "").equals(rarity, true) && it.language.equals(lang, true)
            }
            val cm = if (lang.equals("KR", true)) emptyList() else
                katalog.firstOrNull { it.code.equals(code, true) && it.rarity.equals(rarity, true) && it.cm.isNotEmpty() }?.cm ?: emptyList()
            val mitPreis = eigen.firstOrNull { (it.price ?: 0.0) > 0 }
            out[k] = Druck(code, rarity, lang, cm, eigen.sumOf { it.quantity }, DruckPreis.fuer(mitPreis?.price, cm, trend), mitPreis ?: eigen.firstOrNull())
        }
        known.forEach { nimm(it.setCode, it.rarity, it.language) }
        besitz.forEach { nimm(it.setCode, it.rarity ?: "Unknown", it.language) }
        return out.values.toList()
    }

    fun startAuswahl(selected: SetOption?, ersatz: SetOption?): String? {
        val s = selected ?: ersatz ?: return null
        if (s.setCode.equals("Unknown", true)) return null
        return key(s.setCode, s.rarity, s.language)
    }

    fun kopfPreis(drucke: List<Druck>, auswahl: String?, sicher: Boolean, kandidaten: List<SetOption>): DruckPreis.Preis {
        val gewaehlt = drucke.firstOrNull { key(it.setCode, it.rarity, it.language) == auswahl }
        if (sicher && gewaehlt != null) return gewaehlt.preis
        val keys = kandidaten.map { key(it.setCode, it.rarity, it.language) }.toSet()
        val basis = if (keys.isEmpty()) drucke else drucke.filter { key(it.setCode, it.rarity, it.language) in keys }
        return DruckPreis.spanneUeber(basis.map { it.preis })
    }

    /** Spec §5: Stand der Preisdatei erst ab 3 Tagen Alter anzeigen. */
    fun standText(datum: String?, heute: LocalDate): String? {
        val d = runCatching { LocalDate.parse(datum ?: return null) }.getOrNull() ?: return null
        if (ChronoUnit.DAYS.between(d, heute) < 3) return null
        return "Stand %02d.%02d.".format(d.dayOfMonth, d.monthValue)
    }
}
