package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Die Liste der Exemplare ohne Behaelter -- ABGELEITET aus den ohnehin geladenen Exemplaren,
 * nicht noch einmal vom Server geholt.
 *
 * Vorher stand dafuer ein eigener Netzaufruf (`CollectionRepository.listUnsortedCopies`), obwohl
 * `loadCopies()` dieselben Zeilen schon mitbringt. Der Grund war allein die REIHENFOLGE: der
 * Server sortierte `created_at.asc,copy_id.asc` (aeltestes Exemplar zuerst, wie der Desktop),
 * `loadCopies()` dagegen nach `copy_id` und damit nach UUID -- willkuerlich. Seit `created_at` in
 * `COPY_COLS` steht und an `CopyRow` haengt, laesst sich dieselbe Reihenfolge hier herstellen.
 *
 * Die Reihenfolge ist SICHTBAR (Auswahlangebot im Fach-Fuellen-Sheet, Liste "Nicht einsortiert")
 * und muss deshalb Zeile fuer Zeile die bisherige bleiben:
 * - erst `created_at` aufsteigend, dann `copy_id` aufsteigend -- dieselbe Regel wie
 *   `desktop/electron/copies.cjs#listUnsortedCopies` (`ORDER BY cp.created_at, cp.copy_id`);
 * - Zeilen OHNE `created_at` stehen hinten. So verhaelt sich `order=created_at.asc` in PostgREST,
 *   weil PostgreSQL bei ASC `NULLS LAST` einsetzt -- das war die Reihenfolge, die bisher ankam.
 *   Ein alter Server-Stand ohne die Spalte liefert dann eben alles nach `copy_id`.
 *
 * `created_at` wird als ZEICHENKETTE verglichen, nicht als Zeitpunkt. Das ist richtig, solange
 * alle Werte aus derselben Quelle im selben ISO-8601-Format kommen (PostgREST liefert sie
 * einheitlich, mit gleicher Zeitzone) -- dann ist die lexikografische Ordnung die zeitliche. Ein
 * eigenes Datumszerlegen waere eine zweite Fehlerquelle ohne Gewinn.
 *
 * Eigene Datei und nicht in `BinderGrid`: das hier ist keine Rechnung der Binder-ANSICHT, sondern
 * eine Aussage ueber die ganze Sammlung -- die Behaelterliste, der aufgeschlagene Behaelter und
 * der Startbildschirm brauchen sie gleichermassen.
 */
object UnsortedCopies {

    private val ORDER: Comparator<CopyRow> =
        compareBy<CopyRow> { it.createdAt == null }   // false vor true -> fehlende Zeitstempel hinten
            .thenBy { it.createdAt ?: "" }
            .thenBy { it.copyId }

    /**
     * Lebende Exemplare ohne Behaelter, aeltestes zuerst. Eingabe: alle geladenen Exemplare.
     * `deleted` wird HIER geprueft und nicht dem Aufrufer ueberlassen: `loadCopies()` filtert zwar
     * serverseitig, aber die abgeloeste Abfrage tat es auch -- "lebend" ist Teil der Aussage.
     */
    fun from(copies: List<CopyRow>): List<CopyRow> =
        copies.filter { it.containerId == null && !it.deleted }.sortedWith(ORDER)
}
