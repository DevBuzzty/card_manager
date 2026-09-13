package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.printingKey

/**
 * Arbeitet vom Server gelieferte Zeilen in eine Tabelle des Speichers ein (Spec §4.2).
 *
 * - Geloescht (Karte zusaetzlich: Menge <= 0) -> Schluessel entfernen.
 * - Sonst einsetzen oder ersetzen.
 * - Aendert sich nichts, kommt DIESELBE Liste zurueck (`===`). Der Speicher gleicht alle 10 s ab;
 *   eine neue, gleiche Liste liesse jede Seite ohne Grund neu zeichnen.
 * - Eine doppelt gelieferte, unveraenderte Zeile aendert nichts -- Voraussetzung der Ueberlappung
 *   in SyncCursor.
 *
 * Sortiert wird nach Codepunkten der Schluessel, nicht nach der Datenbank-Kollation; keine Seite
 * zeigt diese Listen in Lieferreihenfolge (Spec §4.1, "Reihenfolge im Speicher").
 */
object DeltaMerge {

    fun <T> merge(
        current: List<T>,
        delivered: List<T>,
        key: (T) -> String,
        gone: (T) -> Boolean,
        order: Comparator<in T>,
    ): List<T> {
        if (delivered.isEmpty()) return current
        val byKey = LinkedHashMap<String, T>(current.size + delivered.size)
        for (row in current) byKey[key(row)] = row
        var changed = false
        for (row in delivered) {
            val k = key(row)
            if (gone(row)) {
                if (byKey.remove(k) != null) changed = true
            } else {
                if (byKey.put(k, row) != row) changed = true
            }
        }
        return if (changed) byKey.values.sortedWith(order) else current
    }

    val CARD_ORDER: Comparator<CardRow> =
        compareBy<CardRow>({ it.id }, { it.setCode }, { it.language }, { it.rarity ?: "Unknown" })
    val COPY_ORDER: Comparator<CopyRow> = compareBy { it.copyId }
    val CONTAINER_ORDER: Comparator<ContainerRow> = compareBy<ContainerRow>({ it.sortOrder }, { it.containerId })

    fun cards(current: List<CardRow>, delivered: List<CardRow>): List<CardRow> =
        merge(current, delivered, { it.printingKey() }, { it.deleted || it.quantity <= 0 }, CARD_ORDER)

    fun copies(current: List<CopyRow>, delivered: List<CopyRow>): List<CopyRow> =
        merge(current, delivered, { it.copyId }, { it.deleted }, COPY_ORDER)

    fun containers(current: List<ContainerRow>, delivered: List<ContainerRow>): List<ContainerRow> =
        merge(current, delivered, { it.containerId }, { it.deleted }, CONTAINER_ORDER)
}
