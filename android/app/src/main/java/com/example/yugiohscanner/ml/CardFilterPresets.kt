package com.example.yugiohscanner.ml

// Spec I §3.3 -- Zwilling zu desktop/src/utils/cardFilters.js. Werte kommen aus der gemeinsamen
// Fixture docs/fixtures/design/filter-presets.json (auch von cardFilters.test.js gelesen).
object CardFilterPresets {
    val ALLE = listOf("unvollstaendig" to "Unvollständige Daten", "foils" to "Nur Foils")

    // Ein Druck (Printing) einer Karte -- gemeinsamer Typ fuer Einzel- und Gruppenpruefung.
    data class Druck(val setCode: String?, val rarity: String?, val price: Double)

    // Foil-Regel wie getRarityInfo (desktop/src/utils/rarity.js) -- keine eigene Liste, damit es
    // nur EINE Einordnung im Projekt gibt. Reihenfolge ist wichtig: common/short print/unknown vor
    // secret-artig vor ultra vor super, sonst kein Foil (z. B. "Rare").
    private fun istFoil(rarity: String?): Boolean {
        val r = (rarity ?: "").lowercase()
        return when {
            r.isEmpty() || r.contains("common") || r.contains("short print") || r == "unknown" -> false
            r.contains("secret") || r.contains("ultimate") || r.contains("ghost") ||
                r.contains("starlight") || r.contains("prismatic") || r.contains("collector") -> true
            r.contains("ultra") -> true
            r.contains("super") -> true
            else -> false
        }
    }

    fun trifft(setCode: String?, rarity: String?, price: Double, id: String): Boolean = when (id) {
        "unvollstaendig" -> setCode.isNullOrBlank() || setCode == "Unknown" || rarity.isNullOrBlank() || price <= 0.0
        "foils" -> istFoil(rarity)
        else -> false
    }

    // Eine Kachel (mehrere Drucke desselben Passcodes) trifft eine Voreinstellung, wenn IRGENDEIN
    // Druck sie trifft -- wie die anderen Filter der Kartenliste. Leere Liste trifft nichts.
    fun trifftGruppe(drucke: List<Druck>, id: String): Boolean =
        drucke.isNotEmpty() && drucke.any { trifft(it.setCode, it.rarity, it.price, id) }
}
