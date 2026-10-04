package com.example.yugiohscanner.ui

import com.example.yugiohscanner.ml.ScanSprache

/** Spec 2026-10-04 Kamera-Bildschirm -- Texte und Umschaltlogik der Bedienelemente (Compose-frei, getestet). */
object ScanOverlayLogik {
    fun pcText(verbunden: Boolean) = if (verbunden) "PC verbunden" else "nur Handy"

    fun sprachText(fest: String?) = fest?.let { "${langFlag(it)} $it" } ?: "🌐 Auto"

    /** Auto -> DE -> EN -> KR -> JP -> Auto (Reihenfolge aus ScanSprache.OPTIONEN). */
    fun naechsteSprache(aktuell: String?): String? {
        val o = ScanSprache.OPTIONEN
        return o[(o.indexOf(aktuell) + 1) % o.size]
    }

    fun modusEtikett(modus: String) = if (modus == "stapel") "STAPEL" else "EINZELN"

    fun fokusText(fest: Boolean) = if (fest) "◎ Fokus fest" else "◎ Fokus"

    fun vorgemerktText(n: Int) = if (n == 1) "1 Karte vorgemerkt" else "$n Karten vorgemerkt"

    fun gesendetText(n: Int) = "$n an den PC gesendet"

    fun zaehlerText(n: Int) = "+$n"

    fun ipGueltig(ip: String) = ip.isNotBlank()
}
