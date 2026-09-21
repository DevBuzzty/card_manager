package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.RarityQuellen
import com.example.yugiohscanner.cloud.SetOption

/**
 * Die Preiszeilen der Karten-Info im Fotomodus (Nutzerentscheid 21.09.2026): je Druck Set-Code,
 * Rarity, Preis und die eigene Anzahl, der teuerste zuerst. Rein und ohne Android-Typen.
 *
 * ACHTUNG, zwei Waehrungen: YGOPRODecks `set_price` je Druck ist ein US-Dollar-Richtwert
 * (TCGplayer); Cardmarket-Euro JE RARITY gibt es nur fuer Drucke aus der eigenen Sammlung (taegliche
 * Cardmarket-Aktualisierung). Jede Zeile traegt deshalb ihre Waehrung, und die Anzeige schreibt sie
 * aus -- Dollar und Euro unbeschriftet nebeneinander waeren verwechselbar.
 */
object KartenInfo {

    enum class Waehrung { EUR, USD }

    data class Zeile(
        val setCode: String,
        val rarity: String,
        val language: String,
        val preis: Double?,
        val waehrung: Waehrung?,
        val anzahl: Int,
    )

    // Praefix + Nummer ohne Region -- MAMO-DE072 und MAMO-EN072 sind dieselbe Druckzeile.
    private val CODE = Regex("^([A-Z0-9]{2,6})-([A-Z]{1,2})([A-Z]?\\d{1,4})$")
    private fun zeile(code: String): String? =
        CODE.matchEntire(code.trim().uppercase())?.let { m ->
            m.groupValues[1] + "|" + m.groupValues[3].replace(Regex("^([A-Z]?)0+(?=\\d)"), "$1")
        }

    /**
     * [drucke] ist die Druckliste der Karte (PrintingRepository, schon durch RarityQuellen),
     * [besitz] sind die eigenen Drucke dieser Karte aus der Sammlung.
     *
     * Preis je Zeile: eigener Druck mit Preis -> dessen Euro-Preis; sonst YGOPRODecks Dollar-Richtwert
     * des Drucks selbst oder -- deutsche Drucke tragen keinen -- seines gleichnummerigen Geschwisters
     * derselben Rarity. Eine unbekannte Rarity uebernimmt die des Geschwisters, wenn es genau eine
     * gibt (wie printingRarity.js am PC). Eigene Drucke, die in der Liste fehlen, kommen dazu.
     * Sortiert: teuerste zuerst, Zeilen ohne Preis ans Ende.
     */
    fun preiszeilen(drucke: List<SetOption>, besitz: List<CardRow>): List<Zeile> {
        val rarityVon = HashMap<String, MutableSet<String>>()
        val dollarVon = HashMap<String, Double>()
        for (d in drucke) {
            val z = zeile(d.setCode) ?: continue
            if (RarityQuellen.kenntRarity(d.rarity)) {
                rarityVon.getOrPut(z) { LinkedHashSet() }.add(d.rarity)
                if (d.price > 0) dollarVon.merge("$z|${d.rarity.lowercase()}", d.price) { a, b -> maxOf(a, b) }
            }
        }
        fun rarityFuer(code: String, rarity: String): String {
            if (RarityQuellen.kenntRarity(rarity)) return rarity
            val bekannt = zeile(code)?.let { rarityVon[it] }
            return if (bekannt != null && bekannt.size == 1) bekannt.first() else RarityQuellen.UNBEKANNT
        }
        fun eigen(code: String, rarity: String, lang: String) = besitz.firstOrNull {
            it.setCode.equals(code, true) && (it.rarity ?: "").equals(rarity, true) && it.language.equals(lang, true)
        }

        val out = LinkedHashMap<String, Zeile>()
        fun nimm(code: String, rarityRoh: String, lang: String, dollar: Double) {
            val rarity = rarityFuer(code, rarityRoh)
            val key = "${code.uppercase()}|${rarity.lowercase()}|${lang.uppercase()}"
            if (key in out) return
            val mein = eigen(code, rarity, lang)
            val (preis, waehrung) = when {
                mein?.price != null && mein.price > 0 -> mein.price to Waehrung.EUR
                dollar > 0 -> dollar to Waehrung.USD
                else -> (zeile(code)?.let { dollarVon["$it|${rarity.lowercase()}"] })?.let { it to Waehrung.USD }
                    ?: (null to null)
            }
            out[key] = Zeile(code, rarity, lang, preis, waehrung, mein?.quantity ?: 0)
        }
        for (d in drucke) nimm(d.setCode, d.rarity, d.language, d.price)
        for (b in besitz) if (!b.deleted && b.quantity > 0) nimm(b.setCode, b.rarity ?: "", b.language, 0.0)

        return out.values.sortedWith(compareByDescending<Zeile> { it.preis ?: -1.0 })
    }
}
