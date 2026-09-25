package com.example.yugiohscanner.cloud

/**
 * Eine erfundene Rarity ist schlimmer als keine.
 *
 * Gemessen am 20.09.2026: Konamis DEUTSCHE Kartendatenbank nennt zu KEINEM Druck eine Rarity
 * (geprueft an Dupe Frog, cid 7788 -- kein einziges `lr_icon`). Beide Fassungen machten daraus
 * "Common", und weil die Vorauswahl die NIEDRIGSTE Rarity nimmt ([com.example.yugiohscanner.ml.
 * RarityRank.lowest] hier, `findBestDefaultSet` am PC), gewann dieses erfundene Common jedes Mal.
 * In einer Stichprobe von 14 Nicht-Common-Karten des Nutzers war das Ergebnis 14 von 14
 * mehrdeutig, immer mit Common dabei -- "BLGG-DE055: Ultra Rare / Common" und so fort.
 *
 * Der JS-Zwilling steht in `desktop/electron/rarity-sources.cjs`. Wer hier etwas aendert, aendert
 * dort mit -- die Regel wohnt zweimal, weil beide Geraete dieselben drei Quellen mischen.
 */
object RarityQuellen {

    const val UNBEKANNT = "Unknown"

    // YGOPRODeck schreibt "New" in set_rarity, solange die Rarity eines frisch erschienenen Sets
    // noch nicht erfasst ist (gemessen 20.09.2026 an BLGG-EN045 "Fallin' Cheatah"). Im TCG gibt es
    // keine Rarity dieses Namens -- im Scan-Protokoll steht deshalb "Rarity mehrdeutig: Ultra
    // Rare/New".
    private val PLATZHALTER = setOf("unknown", "new")

    /**
     * Nennt diese Quelle wirklich eine Rarity? Leer, "Unknown" und "New" heissen alle drei: nein --
     * und ebenso eine Angabe OHNE JEDEN BUCHSTABEN.
     *
     * Letzteres stammt aus einem echten Lauf (20.09.2026): fuer das frische Set "Legendary Arc-V
     * Decks" liefert YGOPRODeck `set_rarity: "3"` bzw. "2" (94 Drucke im Katalog). Als Rarity
     * gefuehrt ergibt das Anzeigen wie "Rarity mehrdeutig: 3/Secret Rare/Starlight Rare".
     */
    /** Anzeige in Filter, Chips und Suche: keine Auskunft -> "Unbekannt", Anhaengsel wie in "Rare-->" fallen weg.
     *  ZWILLING: desktop/src/utils/printingRarity.js#rarityDisplay, Fixture docs/fixtures/valuation/rarity-display.json. */
    const val UNKNOWN_LABEL = "Unbekannt"
    private val TRAILING = Regex("[^A-Za-z0-9')]+$")
    fun display(rarity: String?): String {
        val r = rarity?.trim().orEmpty().replace(TRAILING, "")
        return if (kenntRarity(r)) r else UNKNOWN_LABEL
    }

    fun kenntRarity(rarity: String?): Boolean {
        val r = rarity?.trim().orEmpty()
        if (r.isEmpty() || r.lowercase() in PLATZHALTER) return false
        return r.any { it.isLetter() }
    }

    private val QUELLCODE = Regex("^([A-Z0-9]{2,6})-([A-Z]{1,2})([OI])(\\d{1,4})$")

    /**
     * Ein Druck-Code aus einer QUELLE (nicht aus der OCR), mit den zwei Zeichen repariert, die dort
     * nie stehen koennen.
     *
     * Gemessen, nicht vermutet: YGOPRODeck fuehrt die Karten von "Legendary Arc-V Decks" als
     * "LAVD-ENO11" -- Buchstabe O statt Null. Auf der Karte steht "LAVD-DE011", die OCR las das am
     * 20.09. korrekt, und der Abgleich stellte die kaputte Quelle darueber: angeboten wurde
     * "LAVD-DEO11", das der Nutzer von Hand korrigieren musste, und die Region las sich als EN
     * statt DE. Im ganzen Katalog steht dieses O NUR bei LAVD (55 Drucke), es ist also kein echter
     * Variantenbuchstabe -- den gibt es (SGX3-DEA10), aber niemals als O oder I: Konami druckt
     * keine Zeichen, die mit 0 und 1 verwechselbar sind.
     */
    fun repariereQuellcode(code: String): String {
        val c = code.trim().uppercase()
        val m = QUELLCODE.matchEntire(c) ?: return code.trim()
        val (praefix, region, zeichen, nummer) = m.destructured
        return praefix + "-" + region + (if (zeichen == "O") "0" else "1") + nummer
    }

    /**
     * Kennt EINE Quelle die Rarity eines Codes, zaehlen nur noch die Zeilen MIT Rarity. Kennt keine
     * sie, bleibt genau eine Zeile mit "Unknown" ueber.
     *
     * Mehrere ECHTE Rarities zu einem Code bleiben erhalten (MAMO-DE015 gibt es als Ultra Rare UND
     * als Starlight Rare) -- darueber darf die Ampel reden. Reihenfolge bleibt unangetastet.
     */
    fun ohneErfundeneRarity(roh: List<SetOption>): List<SetOption> {
        // Erst die Codes reparieren, dann gruppieren: sonst stuenden "LAVD-ENO11" und ein anderswo
        // sauber geliefertes "LAVD-EN011" als zwei verschiedene Drucke nebeneinander.
        val sets = roh.map { it.copy(setCode = repariereQuellcode(it.setCode)) }
        val kennt = sets.filter { kenntRarity(it.rarity) }.map { it.setCode.uppercase() }.toHashSet()
        val gesehen = HashSet<String>()
        val out = ArrayList<SetOption>(sets.size)
        for (s in sets) {
            val code = s.setCode.uppercase()
            if (code in kennt) {
                if (kenntRarity(s.rarity)) out.add(s)
            } else if (gesehen.add(code)) {
                out.add(s.copy(rarity = UNBEKANNT))
            }
        }
        return out
    }
}
