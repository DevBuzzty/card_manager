package com.example.yugiohscanner.ml

/**
 * PostgREST-Filter "Zeile kommt in der Sortierung nach dieser" (Spec §4.1). Grundlage des Blaetterns
 * nach Schluessel: verschwindet waehrend des Blaetterns eine fruehere Zeile (geloescht, Menge auf 0),
 * ueberspringt Versatz-Blaettern still eine spaetere -- Schluessel-Blaettern nicht.
 *
 * Werte stehen immer in doppelten Anfuehrungszeichen; `"` und `\` darin werden mit `\` maskiert.
 * Sonst zerbraechen Seltenheiten wie "Secret Rare", Kommas oder Klammern den Ausdruck.
 */
object Keyset {

    fun quote(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    /**
     * Inhalt des Query-Parameters `or` (mit aeusseren Klammern) fuer eine aufsteigende Sortierung
     * ueber `columns`: (c1 > v1) oder (c1 = v1 und c2 > v2) oder ...
     */
    fun after(columns: List<String>, after: List<String>): String {
        require(columns.isNotEmpty() && columns.size == after.size) { "Spalten und Werte passen nicht zusammen" }
        val parts = columns.indices.map { i ->
            val equal = (0 until i).map { j -> "${columns[j]}.eq.${quote(after[j])}" }
            val greater = "${columns[i]}.gt.${quote(after[i])}"
            if (equal.isEmpty()) greater else "and(${(equal + greater).joinToString(",")})"
        }
        return "(${parts.joinToString(",")})"
    }
}
