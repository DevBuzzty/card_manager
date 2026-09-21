package com.example.yugiohscanner.ml

/**
 * Welche Karte meint ein Knopfdruck im Fotomodus? Rein und ohne Android-Typen, damit pruefbar.
 *
 * Ein Druck nimmt eine kurze SERIE auf (Nutzerentscheid 21.09.2026: drei Fotos), damit die
 * bewaehrte Gruen-Regel "Set-Code auf zwei Bildern fehlerfrei" erreichbar bleibt, statt fuer Fotos
 * eine lockerere Regel einzufuehren. Je Foto zaehlt die GROESSTE Karte -- die, die hingehalten
 * wird; ein Stapel im Hintergrund oder eine Nachbarkarte am Rand ist kleiner. Die Umrandung ist
 * im Fotomodus nur noch Zielhilfe, kein Filter.
 */
object FotoAuswahl {

    /** Eine erkannte Karte eines Fotos: ihr Passcode und die Flaeche ihrer Box in Bildpunkten. */
    data class Kandidat(val passcode: Int, val flaeche: Float)

    /** Die groesste gueltige Karte eines Fotos, oder null. Passcodes <= 0 sind "nicht erkannt". */
    fun groesste(karten: List<Kandidat>): Kandidat? =
        karten.filter { it.passcode > 0 && it.flaeche > 0f }.maxByOrNull { it.flaeche }

    /**
     * Die Karte der ganzen Serie: der Passcode, der am haeufigsten als groesste Karte kam.
     *
     * Bei Gleichstand gewinnt der mit der groessten Einzelflaeche -- das Foto, auf dem die Karte am
     * groessten war, ist das glaubwuerdigste. `null`, wenn kein Foto eine Karte zeigte.
     */
    fun sieger(jeFoto: List<Kandidat?>): Int? {
        val gueltig = jeFoto.filterNotNull()
        if (gueltig.isEmpty()) return null
        val anzahl = gueltig.groupingBy { it.passcode }.eachCount()
        val meist = anzahl.values.max()
        return gueltig
            .filter { anzahl[it.passcode] == meist }
            .maxByOrNull { it.flaeche }
            ?.passcode
    }
}
