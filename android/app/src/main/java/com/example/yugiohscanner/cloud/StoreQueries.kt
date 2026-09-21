package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.SyncCursor

/**
 * Query-Parameter der Voll- und Delta-Abfragen des Speichers (Spec §4.1, §4.3) -- rein, damit sie
 * ohne Server getestet werden koennen.
 *
 * Vollstaendig (`changedSince == null`): nur lebende Zeilen, sortiert und geblaettert nach Schluessel.
 * Delta: `updated_at >= changedSince` OHNE Loesch-/Mengenfilter, sortiert und geblaettert nach
 * (updated_at, Schluessel). Zeitstempel gehen in der Form `SyncCursor.normalize` hinaus -- mit `Z`,
 * denn ein `+` in der URL hiesse Leerzeichen.
 *
 * `cards` bleibt bei `select=*` (Spec §4.1, "Spalten").
 */
object StoreQueries {
    const val PAGE = 1000

    const val COPY_COLS =
        "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,for_sale,created_at,updated_at"
    const val CONTAINER_COLS = "container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at"

    private val CARD_KEY = listOf("id", "set_code", "language", "rarity")

    fun cards(changedSince: String?, after: CardRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build("*", listOf("deleted" to "eq.false", "quantity" to "gt.0"), CARD_KEY, after?.let(::cardKey))
        } else {
            build("*", listOf("updated_at" to "gte.$changedSince"), listOf("updated_at") + CARD_KEY,
                after?.let { listOf(stamp(it.updatedAt)) + cardKey(it) })
        }

    fun copies(changedSince: String?, after: CopyRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build(COPY_COLS, listOf("deleted" to "eq.false"), listOf("copy_id"), after?.let { listOf(it.copyId) })
        } else {
            build(COPY_COLS, listOf("updated_at" to "gte.$changedSince"), listOf("updated_at", "copy_id"),
                after?.let { listOf(stamp(it.updatedAt), it.copyId) })
        }

    fun containers(changedSince: String?, after: ContainerRow?): List<Pair<String, String>> =
        if (changedSince == null) {
            build(CONTAINER_COLS, listOf("deleted" to "eq.false"), listOf("container_id"), after?.let { listOf(it.containerId) })
        } else {
            build(CONTAINER_COLS, listOf("updated_at" to "gte.$changedSince"), listOf("updated_at", "container_id"),
                after?.let { listOf(stamp(it.updatedAt), it.containerId) })
        }

    private fun build(
        select: String,
        filters: List<Pair<String, String>>,
        keyColumns: List<String>,
        after: List<String>?,
    ): List<Pair<String, String>> {
        val p = ArrayList<Pair<String, String>>()
        p += "select" to select
        p += filters
        p += "order" to keyColumns.joinToString(",") { "$it.asc" }
        p += "limit" to PAGE.toString()
        if (after != null) p += "or" to Keyset.after(keyColumns, after)
        return p
    }

    // Blaetter-Schluessel = Primaerschluessel, der am Server nie null ist: `parse` macht aus der
    // leeren Seltenheit `""` ein `null`, also steht `null` hier fuer `""`. "Unknown" statt dessen
    // uebersprang still alle Drucke mit Seltenheit zwischen "" und "Unknown" (Abschlussreview F2).
    private fun cardKey(c: CardRow) = listOf(c.id, c.setCode, c.language, c.rarity ?: "")

    private fun stamp(s: String?): String =
        SyncCursor.normalize(s ?: throw IllegalStateException("Delta-Zeile ohne updated_at"))
}
