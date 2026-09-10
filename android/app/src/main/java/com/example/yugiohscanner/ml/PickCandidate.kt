package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Spec B2 (Spec S6.3): welches physische Exemplar ein Scan im Einsortier-Modus meint. Ein
 * Scan liefert einen Passcode und moeglicherweise Set-Code-Kandidaten (OCR liest oft mehrere);
 * diese Funktion entscheidet daraus, welches Exemplar der Sammlung gemeint ist. Tasks 6 und 7
 * (Einsortier-Modus) rufen `pick` auf.
 */
sealed interface Pick {
    data class One(val copyId: String) : Pick          // genau ein Kandidat
    data class Many(val copyIds: List<String>) : Pick   // Auswahl-Sheet
    data object AllPlaced : Pick                        // alle Exemplare schon einsortiert
    data object NotOwned : Pick                         // Karte nicht in der Sammlung
}

object PickCandidate {

    /**
     * `defaultEdition`/`defaultCondition` sind die Voreinstellungen aus den Einstellungen
     * (settings.default_edition/default_condition) -- die Funktion selbst ist rein und fragt
     * nichts ab.
     */
    fun pick(
        copies: List<CopyRow>,
        passcode: String,
        setCodes: List<String>,
        defaultEdition: String,
        defaultCondition: String,
    ): Pick {
        val live = copies.filter { !it.deleted && it.cardId == passcode }
        if (live.isEmpty()) return Pick.NotOwned

        val unsorted = live.filter { it.containerId == null }
        if (unsorted.isEmpty()) return Pick.AllPlaced

        val narrowed = if (setCodes.isEmpty()) {
            unsorted
        } else {
            val matched = unsorted.filter { copy -> setCodes.any { it.equals(copy.setCode, ignoreCase = true) } }
            matched.ifEmpty { unsorted }
        }

        if (narrowed.size == 1) return Pick.One(narrowed[0].copyId)

        val (standard, abweichend) = narrowed.partition {
            it.edition == defaultEdition && it.condition == defaultCondition
        }
        return Pick.Many((standard + abweichend).map { it.copyId })
    }
}
