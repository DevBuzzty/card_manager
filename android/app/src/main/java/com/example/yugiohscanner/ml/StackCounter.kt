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
    private var schwachMs = 0L
    private var zuletztGebucht = 0

    /**
     * Schwacher Stoss (ChuteGate.Burst.schwach): wird nur eingeloest, wenn die naechste Bestaetigung
     * binnen [SCHWACH_FENSTER_MS] eine ANDERE Karte ist als die zuletzt gebuchte -- dann muss eine Karte
     * dazugekommen sein. Bei gleichen Karten bleibt ein schwacher Stoss wirkungslos.
     */
    fun schwach(tMs: Long) {
        schwachMs = tMs
    }

    fun einwurf(anzahl: Int, tMs: Long) {
        if (anzahl <= 0) return
        expire(tMs)
        pending += anzahl
        lastEinwurfMs = tMs
    }

    /** Fuer eine Bestaetigung von [passcode]: wie oft +1 gebucht wird (0 = nicht zaehlen). */
    fun claim(tMs: Long, passcode: Int = 0): Int {
        expire(tMs)
        var k = pending
        pending = 0
        if (k == 0 && schwachMs != 0L && tMs - schwachMs <= SCHWACH_FENSTER_MS &&
            passcode != 0 && zuletztGebucht != 0 && passcode != zuletztGebucht) {
            k = 1
        }
        if (k > 0) {
            schwachMs = 0L
            if (passcode != 0) zuletztGebucht = passcode
        }
        return k
    }

    companion object {
        const val SCHWACH_FENSTER_MS = 6_000L
    }

    private fun expire(tMs: Long) {
        if (pending > 0 && tMs - lastEinwurfMs > maxAgeMs) pending = 0
    }
}
