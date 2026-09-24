package com.example.yugiohscanner.ml

/**
 * Spec H3b §7.6 (H3b2) -- eBay-Hinweise (sale_notices) und Marke „Gebühren vorläufig“ (ebay_orders). ZWILLING von
 * desktop/src/utils/saleNotices.js, gemeinsame Fixture docs/fixtures/ebay/notices.json. Wer eine Fassung ändert,
 * ändert beide. Namensabweichungen: Felder camelCase; JS-`orders[saleId]` = Map saleId -> [OrderMark].
 * Sortierung per Codeeinheiten (String.compareTo), kein Collator.
 */
object SaleNotices {
    data class Notice(
        val noticeId: String, val kind: String, val text: String, val saleId: String?, val listingId: String?,
        val dismissed: Boolean, val createdAt: String?,
    )
    data class Label(val label: String, val tone: String)
    data class OrderMark(val status: String, val feesFinal: Boolean)

    const val FEES_PROVISIONAL = "Gebühren vorläufig"

    private val LABELS = mapOf(
        "shipping" to Label("Versand", "warn"),
        "error" to Label("Problem", "bad"),
        "reminder" to Label("Erinnerung", "neutral"),
        "token" to Label("eBay-Verbindung", "bad"),
    )

    /** Offene Hinweise, neueste zuerst; gleiche Zeit nach notice_id. */
    fun sort(list: List<Notice>): List<Notice> =
        list.filter { !it.dismissed }.sortedWith { a, b ->
            val t = (b.createdAt ?: "").compareTo(a.createdAt ?: "")
            if (t != 0) t else a.noticeId.compareTo(b.noticeId)
        }

    fun label(kind: String): Label = LABELS[kind] ?: Label("Hinweis", "neutral")

    fun feesMark(orders: Map<String, OrderMark>, saleId: String): String? {
        val o = orders[saleId] ?: return null
        return if (o.status == "gebucht" && !o.feesFinal) FEES_PROVISIONAL else null
    }

    fun title(count: Int): String = "eBay-Hinweise ($count)"
}
