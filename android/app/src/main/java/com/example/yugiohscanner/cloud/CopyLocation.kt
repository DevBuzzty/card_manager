package com.example.yugiohscanner.cloud

/**
 * Spec B1 §7.3/§10 (Task 10): Standort-Chip-Text fuer ein Exemplar -- ZEICHENGLEICH zur
 * Desktop-Fassung (`desktop/src/utils/copyLocation.js#formatCopyLocation`), damit ein Standort
 * auf beiden Geraeten gleich aussieht. Wer hier etwas aendert, aendert dort mit.
 *
 * Rein und ohne Compose-Abhaengigkeit -- eigene Datei statt in CardDetailScreen/CollectionScreen
 * verschachtelt, damit sie ohne Robolectric als JVM-Unit-Test lauffaehig bleibt (siehe
 * CopyLocationTest), genau wie Tags/ScanAggregator/RarityRank es in diesem Projekt vormachen.
 *
 * `container` ist die zum Exemplar gehoerende Zeile aus ContainersRepository.list() (oder null,
 * wenn keine gefunden wird -- z.B. waehrend Behaelter noch nachgeladen werden).
 */
object CopyLocation {
    fun format(copy: CopyRow, container: ContainerRow?): String {
        if (copy.containerId == null || container == null) return "—"
        if (copy.page != null && copy.slot != null) return "${container.name} · S${copy.page} · F${copy.slot}"
        return container.name
    }
}
