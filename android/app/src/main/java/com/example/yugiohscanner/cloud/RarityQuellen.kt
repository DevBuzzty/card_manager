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

    /** Nennt diese Quelle wirklich eine Rarity? Leer und "Unknown" heissen beide: nein. */
    fun kenntRarity(rarity: String?): Boolean {
        val r = rarity?.trim().orEmpty()
        return r.isNotEmpty() && !r.equals(UNBEKANNT, ignoreCase = true)
    }

    /**
     * Kennt EINE Quelle die Rarity eines Codes, zaehlen nur noch die Zeilen MIT Rarity. Kennt keine
     * sie, bleibt genau eine Zeile mit "Unknown" ueber.
     *
     * Mehrere ECHTE Rarities zu einem Code bleiben erhalten (MAMO-DE015 gibt es als Ultra Rare UND
     * als Starlight Rare) -- darueber darf die Ampel reden. Reihenfolge bleibt unangetastet.
     */
    fun ohneErfundeneRarity(sets: List<SetOption>): List<SetOption> {
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
