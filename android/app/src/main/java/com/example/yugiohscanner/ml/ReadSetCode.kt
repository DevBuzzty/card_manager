package com.example.yugiohscanner.ml

/**
 * Der ROH gelesene Set-Code einer Karte -- das, was auf dem Karton steht, unabhaengig davon, ob es
 * zu der Karte passt, die die Bilderkennung meint.
 *
 * Warum getrennt von [com.example.yugiohscanner.cloud.SetCodeMatch]: jener Abgleich waehlt aus den
 * bekannten Drucken DER ERKANNTEN KARTE. Greift die Bilderkennung die falsche Karte -- bei den 19
 * "Solfachord"-Karten mit ihren aehnlichen Artworks passiert genau das, 13 davon stecken nur in
 * ANGU --, kann dabei der wirklich gedruckte Code (MAMO-DE103) gar nicht herauskommen: er steht in
 * keinem Druck der falschen Karte. Dieser Fund geht deshalb ungefiltert an den PC, der ihn
 * aufloest und den Passcode notfalls tauscht (desktop/electron/setcode-resolve.cjs).
 *
 * Die Entscheidung faellt bewusst NICHT hier: das Handy meldet nur, was es gelesen hat.
 */
object ReadSetCode {

    /**
     * Der am haeufigsten gelesene grammatikreine Set-Code ueber alle Bilder, oder `null`.
     *
     * Haeufigkeit statt erstem Fund: ein einzelnes Bild verliest sich leicht, derselbe Code ueber
     * mehrere Bilder hinweg ist belastbar. Bei Gleichstand gewinnt der zuerst gesehene -- die
     * frueheren Bilder zeigen die Karte in der Regel ruhiger als die letzten (Einwurf).
     */
    fun aus(texte: List<String>): String? {
        val zaehler = LinkedHashMap<String, Int>()
        for (t in texte) {
            // Je Bild zaehlt ein Code nur einmal, auch wenn er doppelt im Text steht.
            for (code in SetCodeOcr.extract(t)) zaehler[code] = (zaehler[code] ?: 0) + 1
        }
        return zaehler.maxByOrNull { it.value }?.key
    }
}
