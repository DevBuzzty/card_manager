package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SaleChannel
import com.example.yugiohscanner.cloud.SaleItemRow
import com.example.yugiohscanner.cloud.SalesData

/**
 * Spec H2 §6/§7 -- reine Aufbereitung fuer die Handy-Oberflaeche (ui/SalesScreen.kt) aus einem
 * geladenen [SalesData]. Gerechnet wird ausschliesslich ueber [SalesMath]; hier steht nur, WELCHE
 * Verkaeufe/Positionen wohin gehoeren. Gegenstueck am PC: desktop/electron/sales.cjs#salesOverview
 * (Kartenzahl je Zeile) und #cardSales, desktop/src/components/SaleDetail.jsx (Positionsreihenfolge,
 * Kanalauswahl beim Bearbeiten). Kein Fixture-Zwilling -- die Regeln sind am PC SQL bzw. Oberflaeche.
 */
object SalesOverview {
    data class ListRow(val sale: SalesMath.SaleHead, val netCents: Long, val marketCents: Long, val cards: Int, val doubleSold: Boolean)
    data class Overview(
        val totals: SalesMath.Totals,
        val byChannel: List<SalesMath.ChannelRow>,
        val byMonth: List<SalesMath.MonthRow>,
        val rows: List<ListRow>,
    )
    data class SoldRow(val item: SaleItemRow, val sale: SalesMath.SaleHead)

    private fun SalesMath.SaleHead.live() = status == "aktiv" && !deleted

    /**
     * Wie sales.cjs#salesOverview: Kennzahlen, Kanaele und Liste ueber den Zeitraum, die 12 Monatsbalken
     * ueber ALLE Verkaeufe. Je Zeile Netto/Marktwert ueber SalesMath.listValues; Karten = gezaehlte
     * Positionen bei aktiven Verkaeufen, sonst alle lebenden Positionen. [data].sales steht bereits in
     * Anzeige-Reihenfolge (SalesRepository.displayOrder).
     */
    fun overview(data: SalesData, period: String, today: String): Overview {
        val lines = data.lines()
        val soldInOf: (String) -> String? = data::soldInOf
        val inPeriod = SalesMath.periodFilter(data.sales, period, today)
        val doubles = SalesMath.doubleSold(data.sales, lines)
        val rows = inPeriod.map { s ->
            val v = SalesMath.listValues(s, lines, soldInOf)
            val cards = if (s.live()) SalesMath.countedItems(s, lines, soldInOf).size
                        else lines.count { it.saleId == s.saleId && !it.deleted }
            ListRow(s, v.netCents, v.marketCents, cards, s.saleId in doubles)
        }
        return Overview(
            totals = SalesMath.totals(inPeriod, lines, soldInOf),
            byChannel = SalesMath.byChannel(inPeriod, lines, soldInOf),
            byMonth = SalesMath.byMonth(data.sales, lines, soldInOf, today, 12),
            rows = rows,
        )
    }

    /** Ist [saleId] an einem Doppelverkauf beteiligt (SalesMath.doubleSold)? */
    fun isDoubleSold(data: SalesData, saleId: String): Boolean = saleId in SalesMath.doubleSold(data.sales, data.lines())

    /**
     * „Verkauft" in der Kartenansicht: lebende Positionen dieser Karte samt Verkaufskopf, in der
     * Reihenfolge der Verkaufsliste. Positionen ohne (nicht geloeschten) Kopf fallen weg.
     */
    fun cardSold(data: SalesData, cardId: String): List<SoldRow> {
        val order = HashMap<String, Int>()
        data.sales.forEachIndexed { i, s -> order[s.saleId] = i }
        return data.items.filter { it.cardId == cardId && !it.deleted && it.saleId in order }
            .sortedBy { order.getValue(it.saleId) }
            .map { SoldRow(it, data.sales[order.getValue(it.saleId)]) }
    }

    /** Positionen eines Verkaufs wie sales.cjs#saleDetail: lebende zuerst, dann Marktwert absteigend, dann copy_id. */
    fun detailItems(data: SalesData, saleId: String): List<SaleItemRow> =
        data.items.filter { it.saleId == saleId }
            .sortedWith(compareBy<SaleItemRow> { it.deleted }.thenByDescending { it.valueAtSale }.thenBy { it.copyId })

    /** Marktwert beim Verkauf ueber die lebenden, nicht zur Rueckgabe markierten Positionen (Cent). */
    fun marketCents(items: List<SaleItemRow>, returned: Set<String> = emptySet()): Long =
        items.filter { !it.deleted && it.copyId !in returned }.sumOf { SalesMath.toCents(it.valueAtSale) ?: 0L }

    /** Bearbeiten: ALLE lebenden Positionen ohne die zurueckgenommenen, als (copyId, Marktwert in Cent) fuer SalesRepository.update. */
    fun remaining(items: List<SaleItemRow>, returned: Set<String>): List<Pair<String, Long>> =
        items.filter { !it.deleted && it.copyId !in returned }.map { it.copyId to (SalesMath.toCents(it.valueAtSale) ?: 0L) }

    /** Kanalauswahl beim Bearbeiten: die lebenden Kanaele, dazu vorn der eigene Kanal des Verkaufs, falls er ausgeblendet ist. */
    fun editChannels(channels: List<SaleChannel>, sale: SalesMath.SaleHead): List<SaleChannel> =
        if (channels.any { it.channelId == sale.channelId }) channels
        else listOf(SaleChannel(sale.channelId, sale.channelName, 0.0, false, 0)) + channels

    /**
     * Name fuer update_sale: bleibt der Kanal unveraendert, die am Verkauf gespeicherte Momentaufnahme;
     * sonst der aktuelle Name des gewaehlten Kanals, oder null, wenn es ihn nicht mehr gibt.
     */
    fun channelNameFor(sale: SalesMath.SaleHead, chosenId: String, channels: List<SaleChannel>): String? =
        if (chosenId == sale.channelId) sale.channelName else channels.find { it.channelId == chosenId }?.name

    /** JJJJ-MM-TT -> TT.MM.JJJJ. */
    fun dateText(iso: String): String = iso.split('-').reversed().joinToString(".")
}
