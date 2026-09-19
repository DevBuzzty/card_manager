package com.example.yugiohscanner.ml

/**
 * Modus "stapel": eine gezaehlte Karte geht erst an den Empfaenger (PC/Staging), wenn fuer sie ein
 * Set-Code gelesen wurde oder [maxWaitMs] verstrichen sind. Ohne das ging sie ~0,3 s nach dem
 * Einwurf raus, bevor die OCR einen Beleg hatte -- 4 von 5 Karten ohne Set-Code, der PC buchte sie
 * auf den Standarddruck (docs/superpowers/ledgers/2026-09-17-kartenerkennung-befund/geraet-2-roh.log).
 * Reines Kotlin, kein Android-Import.
 */
class PendingSends(private val maxWaitMs: Long = 1_500L) {

    private data class Offen(var anzahl: Int, val seit: Long)

    private val offen = LinkedHashMap<Int, Offen>()

    fun add(passcode: Int, anzahl: Int, tMs: Long) {
        if (anzahl <= 0) return
        val o = offen[passcode]
        if (o == null) offen[passcode] = Offen(anzahl, tMs) else o.anzahl += anzahl
    }

    /** Faellige Sendungen (passcode to anzahl): Set-Code vorhanden ([hatCode]) oder Wartezeit um. */
    fun due(tMs: Long, hatCode: (Int) -> Boolean): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>()
        val it = offen.entries.iterator()
        while (it.hasNext()) {
            val (pc, o) = it.next()
            if (hatCode(pc) || tMs - o.seit >= maxWaitMs) {
                out.add(pc to o.anzahl)
                it.remove()
            }
        }
        return out
    }

    fun isEmpty(): Boolean = offen.isEmpty()

    /** Alles sofort (bevor die Belege durch einen neuen Einwurf verworfen werden). */
    fun flushAll(): List<Pair<Int, Int>> = offen.map { (pc, o) -> pc to o.anzahl }.also { offen.clear() }
}
