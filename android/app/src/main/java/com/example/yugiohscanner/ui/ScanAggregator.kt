package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.SetOption

/**
 * Spec D4 §4: wohin ein WIEDERHOLTER Scan derselben Karte sein "+1" bucht.
 *
 * Rein und ohne Zustand -- diese Datei entscheidet, [ScanScreen] fuehrt aus. Dasselbe Muster wie
 * [ScanStagingLogic] und `CardZones`: eine Regel, die nur in einem `@Composable` steht, ist in
 * diesem Projekt ungeprueft (es gibt keine Compose-Tests).
 *
 * Die JavaScript-Fassung derselben Regel steht in `desktop/src/utils/scanAggregate.js`. Dass es
 * sie zweimal gibt, ist Absicht (Spec §5): die Zusammenfassung wohnt dort, wo das Staging steht --
 * offline am Handy, bei verbundenem PC am PC. Wer hier etwas aendert, aendert dort mit.
 */
object ScanAggregator {

    sealed interface Target {
        /** Die Menge des Hauptdrucks erhoehen. */
        data object Primary : Target
        /** Die Menge des Zusatzdrucks an [index] in `extraPrintings` erhoehen. */
        data class Extra(val index: Int) : Target
        /** Einen neuen Zusatzdruck fuer [set] anlegen, Menge 1. */
        data class NewExtra(val set: SetOption) : Target
    }

    /**
     * Verglichen wird die volle Druck-Identitaet, nicht nur der Set-Code: die Sammlung
     * schluesselt auf `(id, set_code, language, rarity)`, ein Common und ein Secret Rare desselben
     * Codes sind zwei Zeilen mit eigenem Preis. Beobachtbar macht das keinen Unterschied -- zwei
     * Scans derselben Karte laufen durch denselben `SetCodeMatch` und liefern dieselbe
     * [SetOption] -- es ist nur der sicherere von zwei gleichwertigen Vergleichen.
     */
    private fun key(s: SetOption?): String? =
        s?.let { "${it.setCode}|${it.rarity}|${it.language}" }

    /**
     * @param primary der Hauptdruck des vorhandenen Eintrags, `null` solange er noch aufloest
     * @param extras die Drucke der vorhandenen Zusatzzeilen, in ihrer Reihenfolge; ein Element ist
     *        `null`, wenn die Zeile noch keine Wahl traegt
     * @param scanned der eben aufgeloeste Druck, `null` wenn der Set-Code nicht gelesen wurde
     *
     * Zwei Faelle enden bewusst beide auf [Target.Primary]: kein gelesener Code und ein noch nicht
     * aufgeloester Hauptdruck. In beiden gibt es nichts, wogegen sich vergleichen liesse, und
     * "dieselbe Karte nochmal" ist die richtige Annahme -- der Fehler waere im Staging sichtbar
     * und dort mit einem Klick zu korrigieren, ein faelschlich angelegter Zusatzdruck dagegen
     * schriebe stillschweigend einen zweiten Druck fort.
     */
    fun target(primary: SetOption?, extras: List<SetOption?>, scanned: SetOption?): Target {
        val wanted = key(scanned) ?: return Target.Primary
        val primaryKey = key(primary) ?: return Target.Primary
        if (wanted == primaryKey) return Target.Primary
        val i = extras.indexOfFirst { it != null && key(it) == wanted }
        if (i >= 0) return Target.Extra(i)
        // key(scanned) was non-null above, so scanned itself is non-null here; the compiler can't
        // see that fact through the function call, hence the assertion.
        return Target.NewExtra(scanned!!)
    }
}
