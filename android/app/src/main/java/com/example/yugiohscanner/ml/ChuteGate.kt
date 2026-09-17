package com.example.yugiohscanner.ml

/**
 * Lichtschranke fuer den Modus "stapel": erkennt einen Karten-EINWURF anhand der Bewegung im
 * rechten Randstreifen der Umrandung ([GuideRegion.strip]), gemessen auf jedem Kamerabild
 * (~28/s). Reiner Kotlin-Zustandsautomat, kein Android-Import.
 *
 * Schwellen aus docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/messung-1-roh.log
 * (Auswertung in brief.md):
 * - Ruhe: strip ~0,3. Ein Stoss beginnt beim ersten Bild mit strip >= [AKTIV].
 * - Er endet nach [RUHE_BILDER] aufeinanderfolgenden Bildern mit strip < [AKTIV].
 * - Einwurf = Spitze >= [PEAK] UND Dauer (erstes bis letztes aktives Bild) <= [MAX_DAUER_MS].
 *   Gemessen: 14 Einwuerfe mit Spitze 64-97, Dauer 170-410 ms. Hand von rechts: Spitze <= 30;
 *   Stapel herausnehmen: Spitze <= 31,5, Dauer 1,2-2,9 s.
 */
class ChuteGate {

    companion object {
        const val AKTIV = 3.0
        const val PEAK = 45.0
        const val MAX_DAUER_MS = 600L
        const val RUHE_BILDER = 3
    }

    /** Ein abgeschlossener Stoss: [einwurf] true = als Karte gezaehlt. */
    data class Burst(val einwurf: Boolean, val startMs: Long, val dauerMs: Long, val peak: Double)

    private var active = false
    private var start = 0L
    private var end = 0L
    private var peak = 0.0
    private var calm = 0

    /** Ein Bild einspeisen; liefert den Stoss, der in genau diesem Bild abgeschlossen wurde, sonst null. */
    fun update(strip: Double, tMs: Long): Burst? {
        if (strip < 0) return null // kein Vorbild
        if (strip >= AKTIV) {
            if (!active) {
                active = true
                start = tMs
                peak = 0.0
            }
            end = tMs
            if (strip > peak) peak = strip
            calm = 0
            return null
        }
        if (!active) return null
        calm++
        if (calm < RUHE_BILDER) return null
        active = false
        calm = 0
        val dauer = end - start
        return Burst(peak >= PEAK && dauer <= MAX_DAUER_MS, start, dauer, peak)
    }
}
