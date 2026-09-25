package com.example.yugiohscanner.ml

/**
 * Deutsche Anzeige der englischen Kartendaten (YGOPRODeck: "Spell Card", "DARK", "Dragon") in der Auswertung,
 * Feinschliff 26.09.2026. ZWILLING von desktop/src/utils/cardLabels.js, gemeinsame Fixture
 * docs/fixtures/valuation/card-labels.json. Unbekannte Werte bleiben, wie sie sind.
 */
object CardLabels {
    val ATTRIBUTES = mapOf(
        "DARK" to "Finsternis", "LIGHT" to "Licht", "EARTH" to "Erde", "WATER" to "Wasser", "FIRE" to "Feuer",
        "WIND" to "Wind", "DIVINE" to "Göttlich",
    )
    val RACES = mapOf(
        "Aqua" to "Aqua", "Beast" to "Ungeheuer", "Beast-Warrior" to "Ungeheuer-Krieger", "Creator-God" to "Schöpfergott",
        "Cyberse" to "Cyberse", "Dinosaur" to "Dinosaurier", "Divine-Beast" to "Göttliches Ungeheuer", "Dragon" to "Drache",
        "Fairy" to "Fee", "Fiend" to "Unterweltler", "Fish" to "Fisch", "Illusion" to "Illusion", "Insect" to "Insekt",
        "Machine" to "Maschine", "Plant" to "Pflanze", "Psychic" to "Psi", "Pyro" to "Pyro", "Reptile" to "Reptil",
        "Rock" to "Fels", "Sea Serpent" to "Seeschlange", "Spellcaster" to "Hexer", "Thunder" to "Donner",
        "Warrior" to "Krieger", "Winged Beast" to "Geflügeltes Ungeheuer", "Wyrm" to "Wyrm", "Zombie" to "Zombie",
        "Normal" to "Normal", "Continuous" to "Permanent", "Quick-Play" to "Schnell", "Field" to "Spielfeld",
        "Equip" to "Ausrüstung", "Ritual" to "Ritual", "Counter" to "Konter",
    )

    /** Kartenart als Gruppe: Zauber/Falle vor Monster geprüft (wie Dashboard.kt bisher). */
    fun typeGroup(type: String?): String = when {
        type?.contains("Spell", ignoreCase = true) == true -> "Zauber"
        type?.contains("Trap", ignoreCase = true) == true -> "Falle"
        type?.contains("Monster", ignoreCase = true) == true -> "Monster"
        else -> "Sonstige"
    }

    fun attribute(a: String): String = ATTRIBUTES[a] ?: a
    fun race(r: String): String = RACES[r] ?: r
}
