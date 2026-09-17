package com.example.yugiohscanner.ml

/**
 * Erkennt im Modus "stapel" das Einrutschen einer neuen Karte auf eine bereits liegende (gleiche)
 * Karte, anhand der groben Bildaenderung, die [MlScanAnalyzer] pro Bild berechnet (mittlere
 * absolute Luminanzdifferenz eines 32x32-Downscales zum Vorbild). Reiner Kotlin-Zustandsautomat,
 * kein Android-Import -- so bleibt er ohne Instrumentierungstest pruefbar.
 *
 * Schwellen und Ablauf sind aus der Messung docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/
 * messung-1.txt hergeleitet (siehe brief.md im selben Ordner):
 * - Unruhe beginnt beim ersten Bild mit diff >= [UNRUHE].
 * - Ein "Einrutschen" ist abgeschlossen, wenn die Unruhe mindestens einmal diff >= [PEAK] erreicht
 *   hat, ihre Dauer (erstes bis letztes Bild mit diff >= [UNRUHE]) hoechstens [MAX_DAUER_MS] betrug,
 *   und danach [RUHE_BILDER] aufeinanderfolgende Bilder mit diff < [RUHE] kamen. [update] liefert
 *   `true` genau im letzten dieser ruhigen Bilder.
 * - Dauert die Unruhe laenger als [MAX_DAUER_MS] (z. B. Hand/Wackeln, Karten herausnehmen), wird
 *   sie verworfen -- keine Meldung, sobald wieder [RUHE_BILDER] ruhige Bilder kamen.
 * - Werte zwischen [RUHE] und [UNRUHE] zaehlen weder als Unruhe noch als Ruhe; sie unterbrechen aber
 *   eine begonnene Ruhe-Zaehlung (nur AUFEINANDERFOLGENDE ruhige Bilder zaehlen).
 * - Ein negativer diff (erstes Bild ueberhaupt, [MlScanAnalyzer] hat noch kein Vorbild) wird
 *   ignoriert.
 */
class StackMotion {

    companion object {
        private const val UNRUHE = 4.0
        private const val PEAK = 9.0
        private const val RUHE = 3.0
        private const val RUHE_BILDER = 2
        private const val MAX_DAUER_MS = 1200L
    }

    /**
     * Meldung ODER Verwerfung einer abgeschlossenen Unruhe (siehe [lastDecision]). [unrestStartMs]
     * ist der Zeitstempel des ERSTEN Bildes dieser Unruhe -- Fix Runde 1 (Review von 3c5f3f6,
     * Kritisch #2): eine Karte, die WAEHREND dieser Unruhe erst bestaetigt wurde (z. B. weil die
     * Unruhe schon beim Einfallen der einzigen Karte in ein leeres Fach beginnt, siehe
     * messung-2-roh.log 11:50:00.267-01.639), darf von genau dieser Meldung NICHT rearmt werden --
     * das waere keine zweite, eingerutschte Karte, sondern dieselbe Ankunft doppelt gezaehlt. Der
     * Aufrufer (ScanScreen) rearmt daher nur Passcodes, deren Bestaetigung VOR [unrestStartMs] lag.
     */
    data class Decision(val gemeldet: Boolean, val dauerMs: Long, val unrestStartMs: Long)

    private var unrestActive = false
    private var unrestStart = 0L
    private var unrestEnd = 0L
    private var sawPeak = false
    private var calmCount = 0

    /**
     * Die in genau diesem [update]-Aufruf getroffene Entscheidung (Meldung oder Verwerfung), sonst
     * null. Reine Logging-Hilfe fuer den Aufrufer (siehe [MlScanAnalyzer]/ScanScreen) -- traegt
     * nichts zur Rueckgabe von [update] bei.
     */
    var lastDecision: Decision? = null
        private set

    /** Ein Bild einspeisen. Liefert true genau in dem Bild, in dem ein Einrutschen abgeschlossen ist. */
    fun update(diff: Double, tMs: Long): Boolean {
        lastDecision = null
        if (diff < 0) return false // erstes Bild ueberhaupt -- kein Vorbild zum Vergleich

        if (diff >= UNRUHE) {
            if (!unrestActive) {
                unrestActive = true
                unrestStart = tMs
                sawPeak = false
            }
            unrestEnd = tMs
            if (diff >= PEAK) sawPeak = true
            calmCount = 0
            return false
        }

        if (!unrestActive) return false

        if (diff < RUHE) {
            calmCount++
            if (calmCount >= RUHE_BILDER) {
                val dauer = unrestEnd - unrestStart
                val melden = sawPeak && dauer <= MAX_DAUER_MS
                unrestActive = false
                calmCount = 0
                lastDecision = Decision(melden, dauer, unrestStart)
                return melden
            }
            return false
        }

        // Zwischen RUHE und UNRUHE: unterbricht nur die Ruhe-Zaehlung.
        calmCount = 0
        return false
    }
}
