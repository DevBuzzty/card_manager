package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation

/**
 * Spec I §4.1 -- eine Zeile je Exemplar: Zustand und Auflage vorn, Standort im Klartext, hoechstens
 * zwei Marken ("zum Verkauf", "angeboten"). Fehlt der Behaelter, steht "noch nicht einsortiert" --
 * nie "ohne Standort".
 * ZWILLING: desktop/src/utils/copyRow.js, Fixture docs/fixtures/copies/copy-row.json.
 */
object CopyRowText {
    const val UNSORTED = "noch nicht einsortiert"
    const val MARK_FOR_SALE = "zum-verkauf"
    const val MARK_OFFERED = "angeboten"
    val MARK_LABELS = mapOf(MARK_FOR_SALE to "zum Verkauf", MARK_OFFERED to "angeboten")

    data class Line(val lead: String, val location: String, val unsorted: Boolean, val marks: List<String>)

    /** [container]: der Behaelter zu copy.containerId (null, wenn nicht gefunden); [activeOffers]: Anzahl aktiver Angebote. */
    fun of(copy: CopyRow, container: ContainerRow?, activeOffers: Int): Line {
        val edition = copy.edition.ifBlank { "unknown" }
        val lead = "${copy.condition.ifBlank { "NM" }} · ${Valuation.EDITION_LABELS[edition] ?: edition}"
        val unsorted = copy.containerId == null || container == null
        val location = if (unsorted) UNSORTED else CopyLocation.format(copy, container)
        val marks = buildList {
            if (copy.forSale) add(MARK_FOR_SALE)
            if (activeOffers > 0) add(MARK_OFFERED)
        }
        return Line(lead, location, unsorted, marks)
    }
}
