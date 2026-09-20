package com.example.yugiohscanner.ml

/**
 * Wie stark glaenzt das Artwork? Reine Rechnung auf Bildpunkten -- keine Android-Typen, keine
 * Entscheidung. Wer hier einen Wert bekommt, weiss noch nicht, was er bedeutet.
 *
 * Warum das ueberhaupt Sinn hat, und warum nur HIER: gemessen am 20.09.2026 an 1309 Fotos mit
 * bekannter Rarity (eBay-Korb + eigene Aufnahmen, Wahrheit ueber labels.csv und die Drucke des
 * Offline-Katalogs). Ueber alle Fotos hinweg trennt kein einfaches Bildmass Foil von Nicht-Foil --
 * Saettigung, Farbstreuung und lokale Buntheit liegen alle bei AUC 0,50 bis 0,57, also Muenzwurf.
 * Der Schimmer haengt am Licht und am Winkel, nicht an der Karte.
 *
 * Trennt man aber nach Aufnahmeart, kippt das Bild: auf den 94 Aufnahmen aus der FESTEN Halterung
 * des Nutzers -- immer derselbe Abstand, dasselbe Licht -- erreicht der Anteil heller Bildpunkte
 * AUC 0,83, die Farbstreuung 0,67. Unter konstanten Bedingungen ist Glanz also durchaus messbar.
 * (Die 0,83 gilt fuer [Werte.hell] unveraendert; die Farbstreuung rechnet hier sauberer als das
 * Messskript -- graue Punkte gehen gar nicht ein statt als Farbton 0 --, ihre Zahl ist also ein
 * Anhaltspunkt, kein gemessener Wert fuer genau diese Rechnung.)
 * Genau unter solchen Bedingungen scannt der Nutzer.
 *
 * Deshalb steht hier NOCH KEINE Schwelle und keine Regel: 11 glaenzende gegen 83 matte Aufnahmen
 * sind zu wenig, um eine Grenze festzulegen, die ueber eine Buchung entscheidet. Die Werte gehen
 * vorerst nur ins Scan-Protokoll; ein echter Lauf mit gemischtem Stapel liefert die Grundlage.
 */
object Glanzmass {

    /** [hell] = Anteil sehr heller Bildpunkte (Glanzlichter), [bunt] = Streuung des Farbtons. */
    data class Werte(val hell: Float, val bunt: Float)

    /** Der Namenszug ueber dem Artwork: [schrift] = Helligkeit der Buchstaben, [saettigung] = wie
     *  bunt das Feld insgesamt ist. */
    data class Namenswerte(val schrift: Float, val saettigung: Float)

    private const val HELL_GRENZE = 240

    /**
     * [pixel] sind ARGB-Werte einer Flaeche (Artwork), wie sie `Bitmap.getPixels` liefert.
     * Leere Eingabe ergibt 0/0 -- kein Glanz ist die zurueckhaltende Antwort, nicht "viel".
     */
    /**
     * Der KARTENNAME, gemessen statt geraten: bei Common ist er schwarz gedruckt, ab Rare silbern
     * oder golden. In derselben Messreihe war das auf den Aufnahmen aus der festen Halterung das
     * staerkste Einzelmerkmal -- Schrifthelligkeit AUC 0,84 (Mittelwert 150 bei glaenzenden gegen
     * 89 bei matten Karten), die Saettigung des Feldes 0,77 in die Gegenrichtung. Auf wild
     * beleuchteten eBay-Fotos dagegen wieder Muenzwurf (0,38 bzw. 0,48).
     *
     * [schrift] ist das 20. Perzentil der Helligkeit: die dunkelsten Punkte einer Namenszeile sind
     * die Buchstaben. Ein Mittelwert taete es nicht -- der Untergrund stellt die Mehrheit.
     */
    fun namensMass(pixel: IntArray): Namenswerte {
        if (pixel.isEmpty()) return Namenswerte(0f, 0f)
        val hell = IntArray(pixel.size)
        var sattSumme = 0L
        for (i in pixel.indices) {
            val p = pixel[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            val max = maxOf(r, g, b)
            val min = minOf(r, g, b)
            hell[i] = max
            sattSumme += if (max == 0) 0 else (max - min) * 255 / max
        }
        hell.sort()
        val schrift = hell[(hell.size * 20 / 100).coerceAtMost(hell.size - 1)]
        return Namenswerte(schrift.toFloat(), sattSumme.toFloat() / pixel.size)
    }

    fun aus(pixel: IntArray): Werte {
        if (pixel.isEmpty()) return Werte(0f, 0f)
        var hell = 0
        var bunte = 0
        var sx = 0.0
        var sy = 0.0
        var sx2 = 0.0
        var sy2 = 0.0
        for (p in pixel) {
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            val max = maxOf(r, g, b)
            if (max >= HELL_GRENZE) hell++
            // Farbton als Winkel: ueber 0/360 hinweg mitteln, sonst springt der Wert.
            val min = minOf(r, g, b)
            val spanne = max - min
            if (spanne == 0) continue
            val h = when (max) {
                r -> (g - b).toDouble() / spanne
                g -> 2.0 + (b - r).toDouble() / spanne
                else -> 4.0 + (r - g).toDouble() / spanne
            } * (Math.PI / 3.0)
            val c = Math.cos(h); val s = Math.sin(h)
            bunte++
            sx += c; sy += s; sx2 += c * c; sy2 += s * s
        }
        // Ueber die BUNTEN Punkte mitteln, nicht ueber alle: graue Punkte haben keinen Farbton und
        // werden oben uebersprungen. Teilte man hier trotzdem durch alle, zoege jeder graue Punkt
        // den Mittelwert gegen null und die Streuung kuenstlich nach oben -- eine halb graue,
        // sonst einfarbige Flaeche saehe dann so bunt aus wie ein Regenbogen. Vom Test gefunden.
        val n = bunte.toDouble()
        if (n < 1.0) return Werte(hell / pixel.size.toFloat(), 0f)
        val vx = (sx2 / n) - (sx / n) * (sx / n)
        val vy = (sy2 / n) - (sy / n) * (sy / n)
        val bunt = Math.sqrt(maxOf(0.0, vx) + maxOf(0.0, vy))
        return Werte(hell / pixel.size.toFloat(), bunt.toFloat())
    }
}
