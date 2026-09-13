package com.example.yugiohscanner

import com.example.yugiohscanner.ml.KeysetPager
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Blaettern gegen eine nachgebaute Server-Tabelle: `fetch(after)` liefert die ersten `page` Zeilen
 * mit Schluessel > after -- genau das, was der `or`-Filter aus Keyset am Server bewirkt.
 */
class KeysetPagerTest {

    private data class Row(val ts: String, val key: String)
    private val order = compareBy<Row>({ it.ts }, { it.key })

    private fun server(rows: MutableList<Row>, page: Int, afterEachPage: (Int) -> Unit = {}): suspend (Row?) -> List<Row> {
        var served = 0
        return { after ->
            val out = rows.sortedWith(order).filter { after == null || order.compare(it, after) > 0 }.take(page)
            afterEachPage(served++)
            out
        }
    }

    @Test fun `alle Zeilen ueber mehrere Seiten, jede genau einmal`() = runBlocking {
        val rows = (1..2500).map { Row("t", "k%05d".format(it)) }.toMutableList()
        val got = KeysetPager.all(1000, server(rows, 1000))
        assertEquals(rows, got)
    }

    @Test fun `genaues Vielfaches der Seitengroesse endet mit leerer Seite`() = runBlocking {
        val rows = (1..2000).map { Row("t", "k%05d".format(it)) }.toMutableList()
        assertEquals(2000, KeysetPager.all(1000, server(rows, 1000)).size)
    }

    @Test fun `verschwindet waehrend des Blaetterns eine fruehere Zeile, fehlt keine spaetere`() = runBlocking {
        val rows = (1..2500).map { Row("t", "k%05d".format(it)) }.toMutableList()
        val later = rows.drop(1000)
        // Nach der ersten Seite wird Zeile 10 geloescht -- beim Versatz-Blaettern fiele jetzt k01001 heraus.
        val got = KeysetPager.all(1000, server(rows, 1000) { served -> if (served == 0) rows.removeAt(9) })
        assertEquals(later, got.drop(1000))
    }

    @Test fun `viele Zeilen mit demselben Zeitstempel`() = runBlocking {
        // Ein Preis-Update stempelt hunderte Zeilen gleich; nur nach dem Zeitstempel zu blaettern hinge fest.
        val rows = (1..2500).map { Row("2026-09-13T05:00:00Z", "k%05d".format(it)) }.toMutableList()
        val got = KeysetPager.all(1000, server(rows, 1000))
        assertEquals(2500, got.size)
        assertEquals(2500, got.toSet().size)
    }
}
