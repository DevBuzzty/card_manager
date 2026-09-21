package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import java.text.Collator
import java.util.Locale

/**
 * Spec H2 §5.3/§7/§8/§9 -- Rechenregeln fuer Verkaeufe in ganzen Cent.
 * ZWILLING von desktop/electron/sales-math.cjs (massgeblich am PC) und desktop/src/utils/saleMath.js.
 * Gemeinsame Fixture docs/fixtures/sales/sales.json (SalesMathTest). Wer eine Fassung aendert, aendert alle drei.
 * Rundung ueber java.lang.Math.round (wie JS Math.round), nie kotlin.math.round.
 * Namensabweichung: Kotlin-Funktion heisst `totals`, das JS-Gegenstueck `saleTotals` -- nur der Name unterscheidet
 * sich, die Berechnung ist identisch.
 */
object SalesMath {
    data class SaleHead(val saleId: String, val soldOn: String, val channelId: String, val channelName: String,
                        val gross: Double, val fees: Double?, val shipping: Double?, val status: String, val deleted: Boolean)
    data class SaleLine(val saleId: String, val copyId: String, val valueAtSale: Double, val share: Double, val deleted: Boolean)
    data class Totals(val netCents: Long, val marketCents: Long, val feesCents: Long, val sales: Int, val cards: Int)
    data class ChannelRow(val channelId: String, val channelName: String, val sales: Int, val netCents: Long, val feesCents: Long, val diffCents: Long)
    data class MonthRow(val month: String, val netCents: Long)

    fun toCents(v: Double?): Long? = if (v == null || v.isNaN() || v.isInfinite()) null else Math.round(v * 100)

    fun marketValueCents(price: Double?, priceFirstEd: Double?, edition: String, condition: String): Long {
        val unit = if (edition == "first" && priceFirstEd != null) priceFirstEd else price ?: 0.0
        return Math.round(unit * Valuation.factor(condition) * 100)
    }
    fun marketValueCents(card: CardRow, copy: CopyRow): Long =
        marketValueCents(card.price, card.priceFirstEd, copy.edition, copy.condition)

    fun netCents(gross: Double?, fees: Double?, shipping: Double?): Long =
        (toCents(gross) ?: 0) - (toCents(fees) ?: 0) - (toCents(shipping) ?: 0)

    fun feeDefaultCents(grossCents: Long, feePercent: Double): Long = Math.round(grossCents * feePercent / 100)

    fun distribute(net: Long, values: List<Long>): List<Long> {
        if (values.isEmpty()) return emptyList()
        val total = values.sum()
        val w = if (total > 0) values else values.map { 1L }
        val bigW = if (total > 0) total else values.size.toLong()
        val shares = w.map { Math.round(net.toDouble() * it / bigW) }.toMutableList()
        var big = 0
        for (i in 1 until w.size) if (w[i] > w[big]) big = i
        shares[big] = shares[big] + (net - shares.sum())
        return shares
    }

    private fun SaleHead.live() = status == "aktiv" && !deleted

    fun countedItems(sale: SaleHead, items: List<SaleLine>, soldInOf: (String) -> String?): List<SaleLine> =
        items.filter { it.saleId == sale.saleId && !it.deleted && soldInOf(it.copyId) == sale.saleId }

    data class ListValues(val netCents: Long, val marketCents: Long)

    /**
     * Zeile der Verkaufsliste: Netto/Marktwert EINES Verkaufs (anders als [totals], das ueber mehrere
     * summiert). Aktiver, nicht geloeschter Verkauf: nur gezaehlte Positionen ([countedItems] -- sold_in
     * zeigt auf DIESEN Verkauf, wegen Doppelverkauf). Jeder andere Status (storniert): alle lebenden
     * Positionen OHNE die sold_in-Pruefung -- ein Storno raeumt sold_in am Exemplar, die Positionen
     * bleiben stehen. ZWILLING: sales-math.cjs#saleListValues, saleMath.js#saleListValues.
     */
    fun listValues(sale: SaleHead, items: List<SaleLine>, soldInOf: (String) -> String?): ListValues {
        val counted = if (sale.live()) countedItems(sale, items, soldInOf)
                      else items.filter { it.saleId == sale.saleId && !it.deleted }
        var net = 0L; var market = 0L
        for (it in counted) { net += toCents(it.share) ?: 0; market += toCents(it.valueAtSale) ?: 0 }
        return ListValues(net, market)
    }

    fun doubleSold(sales: List<SaleHead>, items: List<SaleLine>): Set<String> {
        val active = sales.filter { it.live() }.map { it.saleId }.toSet()
        val byCopy = HashMap<String, MutableSet<String>>()
        for (it in items) if (!it.deleted && it.saleId in active) byCopy.getOrPut(it.copyId) { LinkedHashSet() }.add(it.saleId)
        return byCopy.values.filter { it.size > 1 }.flatten().toSet()
    }

    fun totals(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?): Totals {
        var net = 0L; var market = 0L; var fees = 0L; var n = 0; var cards = 0
        for (s in sales.filter { it.live() }) {
            val counted = countedItems(s, items, soldInOf)
            if (counted.isEmpty()) continue
            n += 1; cards += counted.size; fees += toCents(s.fees) ?: 0
            for (it in counted) { net += toCents(it.share) ?: 0; market += toCents(it.valueAtSale) ?: 0 }
        }
        return Totals(net, market, fees, n, cards)
    }

    fun periodFilter(sales: List<SaleHead>, period: String, today: String): List<SaleHead> = when (period) {
        "monat" -> sales.filter { it.soldOn.take(7) == today.take(7) }
        "jahr" -> sales.filter { it.soldOn.take(4) == today.take(4) }
        else -> sales
    }

    fun byChannel(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?): List<ChannelRow> {
        val m = LinkedHashMap<String, ChannelRow>()
        for (s in sales.filter { it.live() }) {
            val t = totals(listOf(s), items, soldInOf)
            if (t.sales == 0) continue
            val r = m[s.channelId] ?: ChannelRow(s.channelId, s.channelName, 0, 0, 0, 0)
            m[s.channelId] = r.copy(sales = r.sales + 1, netCents = r.netCents + t.netCents, feesCents = r.feesCents + t.feesCents,
                diffCents = r.diffCents + (t.netCents - t.marketCents))
        }
        val coll = Collator.getInstance(Locale.GERMAN)
        return m.values.sortedWith { a, b -> if (a.netCents != b.netCents) b.netCents.compareTo(a.netCents) else coll.compare(a.channelName, b.channelName) }
    }

    fun byMonth(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?, today: String, months: Int = 12): List<MonthRow> {
        var y = today.substring(0, 4).toInt(); var mo = today.substring(5, 7).toInt()
        val keys = ArrayList<String>()
        repeat(months) {
            keys.add(0, "%04d-%02d".format(Locale.ROOT, y, mo))
            mo -= 1; if (mo == 0) { mo = 12; y -= 1 }
        }
        return keys.map { k -> MonthRow(k, totals(sales.filter { it.soldOn.take(7) == k }, items, soldInOf).netCents) }
    }

    fun suggestionCents(valueCents: Long?, discountPercent: Int, minCents: Long): Long? {
        if (valueCents == null || valueCents <= 0) return null
        val floored = Math.floorDiv(valueCents * (100 - discountPercent), 500L) * 5
        return maxOf(floored, minCents)
    }

    private val DISCOUNT = Regex("^[0-9]{1,2}$")
    private val MIN_PRICE = Regex("^[0-9]{1,3}(\\.[0-9]{1,2})?$")
    fun normalizeDiscount(raw: String?): Int {
        val s = raw?.trim() ?: ""
        if (!DISCOUNT.matches(s)) return 5
        val n = s.toInt()
        return if (n <= 90) n else 5
    }
    fun normalizeMinPrice(raw: String?): Long {
        val s = (raw?.trim() ?: "").replace(',', '.')
        if (!MIN_PRICE.matches(s)) return 10
        val c = Math.round(s.toDouble() * 100)
        return if (c <= 10000) c else 10
    }

    private const val MINUS = "−"
    fun euroCentsText(c: Long): String {
        val abs = Math.abs(c)
        val euros = String.format(Locale.GERMANY, "%,d", abs / 100)
        val txt = "$euros,${"%02d".format(Locale.ROOT, abs % 100)} €"
        return if (c < 0) MINUS + txt else txt
    }
    fun diffText(net: Long, market: Long): String {
        val d = net - market
        val sign = if (d > 0) "+" else if (d < 0) MINUS else "±"
        val money = sign + euroCentsText(Math.abs(d))
        if (market <= 0) return money
        val pm = Math.round(Math.abs(d) * 1000.0 / market)
        return "$money ($sign${pm / 10},${pm % 10} %)"
    }
}
