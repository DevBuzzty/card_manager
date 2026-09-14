package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Movers
import com.example.yugiohscanner.ml.MoversResult
import com.example.yugiohscanner.ml.PriceRef

/**
 * Merkt Movers.compute ueber Navigationen hinweg (Spec G1 §4.7, Muster DashboardMemo): Speicher und
 * ListCache liefern bei unveraenderten Daten dieselben Listeninstanzen, also genuegt `===`.
 * Ein Merker je Fenster (7/30), damit der Umschalter nicht staendig neu rechnet.
 */
object MoversMemo {
    private class Entry(
        val cards: List<CardRow>, val copies: List<CopyRow>, val refs: List<PriceRef>,
        val today: String, val result: MoversResult,
    )

    private val lock = Any()
    private val entries = HashMap<Int, Entry>()

    private fun hit(e: Entry?, cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String) =
        e != null && e.cards === cards && e.copies === copies && e.refs === refs && e.today == today

    fun get(cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String, days: Int): MoversResult =
        synchronized(lock) {
            val e = entries[days]
            if (hit(e, cards, copies, refs, today)) return@synchronized e!!.result
            Movers.compute(cards, copies, refs, today, days).also { entries[days] = Entry(cards, copies, refs, today, it) }
        }

    fun peek(cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String, days: Int): MoversResult? =
        synchronized(lock) { entries[days]?.takeIf { hit(it, cards, copies, refs, today) }?.result }
}
