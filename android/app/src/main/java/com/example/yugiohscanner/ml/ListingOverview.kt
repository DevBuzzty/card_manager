package com.example.yugiohscanner.ml

/**
 * Spec H3a §6 -- Zeilen der Übersicht „Angebote“ am Handy. Gegenstück zu desktop/electron/listings.cjs#listingsOverview
 * (kein Zwilling im Sinne der gemeinsamen Fixture: die Regeln selbst -- rowTitle, sortListings, listingMarks,
 * daysSince -- liegen in ListingText). Kartenzahl = lebende Positionen; Marktwert = Summe über lebende Positionen mit
 * lebendem Exemplar ([valueOf] null = Exemplar oder Druck fehlt, zählt 0) -- wie am PC.
 */
object ListingOverview {
    const val ALL = "alle"
    val STATUSES = listOf("aktiv" to "Aktiv", "verkauft" to "Verkauft", "beendet" to "Beendet", ALL to "Alle")

    data class Row(
        val head: ListingText.Head, val title: String, val cards: Int, val marketCents: Long, val days: Int, val marks: ListingText.Marks?,
    )

    fun rows(
        heads: List<ListingText.Head>, items: List<ListingText.Item>, valueOf: (String) -> Long?,
        marks: Map<String, ListingText.Marks>, today: String,
    ): List<Row> {
        val byListing = items.filter { !it.deleted }.groupBy { it.listingId }
        return ListingText.sortListings(heads.filter { !it.deleted }).map { l ->
            val live = byListing[l.listingId] ?: emptyList()
            Row(l, ListingText.rowTitle(l, live), live.size, live.sumOf { valueOf(it.copyId) ?: 0L },
                ListingText.daysSince(l.listedOn, today), marks[l.listingId])
        }
    }

    /** [status] aus [STATUSES]; [channelId] null = alle Kanäle. */
    fun filter(rows: List<Row>, status: String, channelId: String?): List<Row> =
        rows.filter { (status == ALL || it.head.status == status) && (channelId == null || it.head.channelId == channelId) }

    /** Je vorkommendem Kanal der Name des jüngsten Angebots (Zeilen sind jüngste zuerst) -- wie ListingsList.jsx. */
    fun channels(rows: List<Row>): List<Pair<String, String>> {
        val m = LinkedHashMap<String, String>()
        for (r in rows) if (r.head.channelId !in m) m[r.head.channelId] = r.head.channelName
        return m.entries.map { it.key to it.value }
    }

    /**
     * Verkaufbar/erneut anbietbar (Spec §7.1/§7.4): lebende Positionen des Angebots, deren Exemplar noch lebt,
     * nach copy_id.
     */
    fun liveCopyIds(items: List<ListingText.Item>, listingId: String, copyLive: (String) -> Boolean): List<String> =
        items.filter { it.listingId == listingId && !it.deleted && copyLive(it.copyId) }.map { it.copyId }.distinct().sorted()
}
