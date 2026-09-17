package com.example.yugiohscanner.ml

/**
 * Modus "stapel": verbindet Einwuerfe ([ChuteGate]) mit Bestaetigungen ([BoxTracker]). Jeder
 * Einwurf ist genau ein +1; er wird von der naechsten Bestaetigung eingeloest. Eine Bestaetigung
 * ohne offenen Einwurf zaehlt nicht (z. B. Karte war nach Hand-Abdeckung kurz "weg"). Wird eine
 * Karte nach dem Einwurf erst spaeter erkannt (schief, Spiegelung), bekommt die naechste
 * Bestaetigung alle offenen Einwuerfe -- verfallen erst nach [maxAgeMs] ohne Bestaetigung.
 * Reines Kotlin, kein Android-Import.
 */
class StackCounter(private val maxAgeMs: Long = 15_000L) {

    private var pending = 0
    private var lastEinwurfMs = 0L

    fun einwurf(anzahl: Int, tMs: Long) {
        if (anzahl <= 0) return
        expire(tMs)
        pending += anzahl
        lastEinwurfMs = tMs
    }

    /** Fuer eine Bestaetigung: wie oft +1 gebucht wird (0 = nicht zaehlen). */
    fun claim(tMs: Long): Int {
        expire(tMs)
        val k = pending
        pending = 0
        return k
    }

    private fun expire(tMs: Long) {
        if (pending > 0 && tMs - lastEinwurfMs > maxAgeMs) pending = 0
    }
}
