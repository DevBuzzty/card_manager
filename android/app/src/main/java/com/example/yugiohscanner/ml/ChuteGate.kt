package com.example.yugiohscanner.ml

/**
 * Lichtschranke fuer den Modus "stapel": erkennt einen Karten-EINWURF anhand der Bewegung im
 * rechten Randstreifen der Umrandung ([GuideRegion.strip]), gemessen auf jedem Kamerabild
 * (~28/s). Reiner Kotlin-Zustandsautomat, kein Android-Import.
 *
 * Schwellen aus docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/ (messung-1, abnahme-1,
 * abnahme-2; Auswertung in brief.md):
 * - Ruhe: strip ~0,3. Ein Stoss beginnt beim ersten Bild mit strip >= [AKTIV] und endet nach
 *   [RUHE_BILDER] aufeinanderfolgenden Bildern darunter.
 * - Einwurf = Spitze >= [PEAK], Dauer (erstes bis letztes aktives Bild) <= [MAX_DAUER_MS], UND
 *   der Stoss steht allein: kein anderer Stoss mit Spitze >= [NACHBAR] endet weniger als
 *   [ABSTAND_MS] vor seinem Beginn oder beginnt weniger als [ABSTAND_MS] nach seinem Ende.
 *   Karten: Spitze 42,7-97, Dauer 130-430 ms, naechster Nachbar >= 1,5 s entfernt. Hand-Wackeln
 *   zerfaellt in mehrere kurze Stoesse (bis Spitze 38,6 bei 432 ms) im Abstand von 0,3-0,6 s --
 *   an der Spitze allein nicht von einer Karte zu trennen, am Nachbarn schon.
 * - Die Einwurf-Meldung kommt darum erst [ABSTAND_MS] nach Stossende.
 */
class ChuteGate {

    companion object {
        const val AKTIV = 3.0
        const val PEAK = 37.0
        const val MAX_DAUER_MS = 600L
        const val RUHE_BILDER = 3
        const val NACHBAR = 10.0
        // 18.09.: 500 -> 350 ms (schnelleres +1). Alle drei Messlogs bleiben bei 250-500 ms fehlerfrei
        // eingeordnet; Hand-Wackel-Stoesse folgen einander nach 0,27-0,6 s.
        const val ABSTAND_MS = 350L
    }

    /** Ein entschiedener Stoss: [einwurf] true = als Karte gezaehlt. */
    data class Burst(val einwurf: Boolean, val startMs: Long, val dauerMs: Long, val peak: Double)

    private var active = false
    private var start = 0L
    private var end = 0L
    private var peak = 0.0
    private var calm = 0

    /** Ende des letzten abgeschlossenen Stosses mit Spitze >= [NACHBAR]. */
    private var lastNachbarEnd = Long.MIN_VALUE / 2

    /** Einwurf-Kandidat, der noch [ABSTAND_MS] ohne Nachbarn nach seinem Ende braucht. */
    private var kandidat: Burst? = null
    private var kandidatEnd = 0L

    /**
     * Ein Bild einspeisen. Liefert einen entschiedenen Stoss (Einwurf, oder zur Protokollierung ein
     * verworfener), sonst null.
     */
    fun update(strip: Double, tMs: Long): Burst? {
        if (strip < 0) return null // kein Vorbild

        // Kandidat bestaetigen: Abstand verstrichen und kein Stoss, der innerhalb davon begann, laeuft noch.
        var out: Burst? = null
        val k = kandidat
        if (k != null && tMs - kandidatEnd >= ABSTAND_MS && !(active && start - kandidatEnd < ABSTAND_MS)) {
            kandidat = null
            out = k
        }

        if (strip >= AKTIV) {
            if (!active) {
                active = true
                start = tMs
                peak = 0.0
            }
            end = tMs
            if (strip > peak) peak = strip
            calm = 0
            val c = kandidat
            if (c != null && peak >= NACHBAR && start - kandidatEnd < ABSTAND_MS) {
                kandidat = null // Nachbar direkt danach: Hand, keine Karte
                return out ?: c.copy(einwurf = false)
            }
            return out
        }
        if (!active) return out
        calm++
        if (calm < RUHE_BILDER) return out
        active = false
        calm = 0
        val dauer = end - start
        val b = Burst(false, start, dauer, peak)
        val allein = start - lastNachbarEnd >= ABSTAND_MS
        if (peak >= NACHBAR) lastNachbarEnd = end
        if (peak >= PEAK && dauer <= MAX_DAUER_MS && allein) {
            kandidat = b.copy(einwurf = true)
            kandidatEnd = end
            return out
        }
        return out ?: b
    }
}
