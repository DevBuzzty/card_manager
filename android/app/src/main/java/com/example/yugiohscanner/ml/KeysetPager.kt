package com.example.yugiohscanner.ml

/**
 * Holt Seite fuer Seite, bis eine Seite kuerzer als `pageSize` ist. `fetch(null)` liefert die erste
 * Seite, `fetch(zeile)` die Seite NACH dieser Zeile (Filter aus Keyset). Warum nach Schluessel und
 * nicht nach Versatz: siehe Keyset.
 */
object KeysetPager {
    suspend fun <T> all(pageSize: Int, fetch: suspend (after: T?) -> List<T>): List<T> {
        val out = ArrayList<T>()
        var after: T? = null
        while (true) {
            val page = fetch(after)
            out.addAll(page)
            if (page.size < pageSize) return out
            after = page.last()
        }
    }
}
