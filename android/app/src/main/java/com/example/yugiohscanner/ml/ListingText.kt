package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Spec H3a §5.3–§7.2 -- Texte und Regeln für Angebote.
 * ZWILLING von desktop/electron/listing-text.cjs (maßgeblich am PC) und desktop/src/utils/listingText.js.
 * Gemeinsame Fixture docs/fixtures/listings/listings.json (ListingTextTest). Wer eine Fassung ändert, ändert alle drei.
 * Längen in UTF-16-Codeeinheiten (String.length = JS .length), alle Texte in der BMP. Vergleiche über String.compareTo
 * (Codeeinheiten, wie JS `<`), nie Collator. Rundung über java.lang.Math.round (wie JS Math.round).
 * Namensabweichungen zum JS: Felder camelCase; Angebote tragen priceCents statt price (Euro); afterListingSale und
 * rowTitle nehmen die Angebotsfelder einzeln; listingLink nimmt cmUrl/nameEn/setCode einzeln; Maps statt Objekte.
 */
object ListingText {
    const val TITLE_MAX = 65
    const val CM_SEARCH = "https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString="
    const val DISCLAIMER = "Privatverkauf, keine Garantie oder Rücknahme."
    val LANGUAGE_NAMES = mapOf(
        "DE" to "Deutsch", "EN" to "Englisch", "FR" to "Französisch", "IT" to "Italienisch",
        "SP" to "Spanisch", "PT" to "Portugiesisch", "JP" to "Japanisch",
    )
    private val TITLE_EDITION = mapOf("first" to "1. Auflage", "limited" to "Limitiert")
    // Wie export-formats.cjs#SALE_EDITION (F1-Verkaufsliste).
    private val LINE_EDITION = mapOf("first" to "1. Auflage", "unlimited" to "Unlimitiert", "limited" to "Limitiert")
    private val EDITION_ORDER = listOf("first", "unlimited", "limited", "unknown")
    private val CONDITION_ORDER = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    private val FIXED_SHORT = mapOf("cardmarket" to "CM", "ebay" to "EB", "kleinanzeigen" to "KA", "tausch" to "TA", "privat" to "PR")
    private val LINKS = mapOf(
        "kleinanzeigen" to "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html",
        "ebay" to "https://www.ebay.de/sl/sell",
    )
    // Zeichen, die JS encodeURIComponent unverändert lässt.
    private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    data class Item(
        val copyId: String, val cardId: String, val name: String?, val setCode: String, val language: String,
        val rarity: String, val edition: String, val condition: String, val nameEn: String? = null,
        val imageUrl: String? = null, val listingId: String = "", val deleted: Boolean = false,
    )
    data class Group(
        val cardId: String, val name: String?, val nameEn: String?, val setCode: String, val language: String,
        val rarity: String, val edition: String, val condition: String, val imageUrl: String?, val count: Int, val copyIds: List<String>,
    )
    data class Head(
        val listingId: String, val channelId: String, val channelName: String, val title: String?, val priceCents: Long,
        val status: String, val listedOn: String, val createdAt: String? = null, val saleId: String? = null,
        val externalUrl: String? = null, val deleted: Boolean = false,
    )
    data class CmEntry(val product: String, val quantity: Int, val language: String, val condition: String, val firstEdition: Boolean, val pieceCents: Long?)
    data class AfterSale(val status: String, val removeCopyIds: List<String>, val priceCents: Long, val askAdjust: Boolean)
    data class Marks(val alsoOn: List<String>, val missing: Boolean, val underSuggestion: Boolean, val saleCancelled: Boolean)
    data class Offer(val listingId: String, val channelId: String, val channelName: String, val priceCents: Long)
    data class RemoveItem(val listingId: String, val copyId: String)
    data class Remind(val listingId: String, val channelName: String, val title: String, val externalUrl: String?)
    data class Cleanup(val removeItems: List<RemoveItem>, val endListings: List<String>, val remind: List<Remind>)
    data class Summary(val listings: Int, val cards: Int, val priceCents: Long)

    private fun known(v: String?) = v != null && v != "" && v != "Unknown"
    private fun nameOf(g: Group): String = g.name?.takeIf { it.isNotEmpty() } ?: g.cardId
    private fun foldName(s: String) =
        s.lowercase(Locale.ROOT).replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    private fun isActive(l: Head) = l.status == "aktiv" && !l.deleted

    private val GROUP_ORDER = Comparator<Group> { a, b ->
        var c = foldName(nameOf(a)).compareTo(foldName(nameOf(b)))
        if (c == 0) c = a.setCode.compareTo(b.setCode)
        if (c == 0) c = a.rarity.compareTo(b.rarity)
        if (c == 0) c = a.language.compareTo(b.language)
        if (c == 0) c = EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
        if (c == 0) c = CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition)
        if (c == 0) c = a.cardId.compareTo(b.cardId)
        c
    }

    fun groupItems(items: List<Item>): List<Group> {
        val m = LinkedHashMap<String, MutableList<Item>>()
        for (item in items) {
            val k = listOf(item.cardId, item.setCode, item.language, item.rarity, item.edition, item.condition).joinToString("|")
            m.getOrPut(k) { ArrayList() }.add(item)
        }
        return m.values.map { l ->
            val f = l.first()
            Group(f.cardId, f.name, f.nameEn, f.setCode, f.language, f.rarity, f.edition, f.condition, f.imageUrl, l.size, l.map { it.copyId }.sorted())
        }.sortedWith(GROUP_ORDER)
    }

    fun truncateTitle(text: String, ellipsis: Boolean): String {
        if (text.length <= TITLE_MAX) return text
        val room = if (ellipsis) TITLE_MAX - 1 else TITLE_MAX
        val cut = text.lastIndexOf(' ', room)
        val head = (if (cut > 0) text.substring(0, cut) else text.substring(0, room)).trimEnd(' ', ',', '–')
        return if (ellipsis) "$head…" else head
    }

    private fun titleParts(g: Group): String = listOfNotNull(
        "Yu-Gi-Oh!", nameOf(g), g.setCode.takeIf { known(it) }, g.rarity.takeIf { known(it) },
        TITLE_EDITION[g.edition], g.condition.takeIf { known(it) }, LANGUAGE_NAMES[g.language],
    ).joinToString(" ")

    fun listingTitle(items: List<Item>): String {
        val groups = groupItems(items)
        if (groups.isEmpty()) return ""
        if (groups.size == 1) {
            val g = groups[0]
            return truncateTitle(if (g.count > 1) "${g.count}× ${titleParts(g)}" else titleParts(g), false)
        }
        val n = groups.sumOf { it.count }
        val names = groups.map { nameOf(it) }.distinct()
        return truncateTitle("Yu-Gi-Oh! Konvolut $n Karten – ${names.joinToString(", ")}", true)
    }

    fun listingDescription(items: List<Item>, priceCents: Long?): String {
        val lines = groupItems(items).map { g ->
            listOfNotNull("${g.count}× ${nameOf(g)}", g.setCode.takeIf { known(it) }, g.rarity.takeIf { known(it) },
                LINE_EDITION[g.edition], g.condition.takeIf { known(it) }).joinToString(" – ")
        }
        val price = priceCents?.let { SalesMath.euroCentsText(it) } ?: "–"
        return (lines + listOf("", "Preis: $price", "", DISCLAIMER)).joinToString("\n")
    }

    fun cardmarketProduct(g: Group): String = listOfNotNull(nameOf(g), g.setCode.takeIf { known(it) }).joinToString(" ")

    fun pieceCents(totalCents: Long, quantity: Int): Long = Math.round(totalCents.toDouble() / quantity)

    fun cardmarketEntry(g: Group, priceCents: Long?): CmEntry = CmEntry(
        cardmarketProduct(g), g.count, LANGUAGE_NAMES[g.language] ?: g.language, g.condition, g.edition == "first",
        priceCents?.let { pieceCents(it, g.count) },
    )

    fun afterListingSale(channelId: String, status: String, priceCents: Long, liveCopyIds: List<String>, soldCopyIds: Collection<String>): AfterSale {
        val live = liveCopyIds.distinct()
        val sold = soldCopyIds.toSet()
        val hit = live.filter { it in sold }.sorted()
        if (hit.isEmpty()) return AfterSale(status, emptyList(), priceCents, false)
        if (hit.size == live.size) return AfterSale("verkauft", emptyList(), priceCents, false)
        // A6 H3b2: eBay rechnet wie Cardmarket mit Stückpreis -- der Rest kostet Stückpreis x Restmenge.
        if (channelId == "cardmarket" || channelId == "ebay") {
            // Nie 0 € (Spec §5.5): ein Stückpreis, der auf 0 Cent fällt, ergäbe ein ungültiges Angebot.
            val rest = maxOf(1L, pieceCents(priceCents, live.size) * (live.size - hit.size))
            return AfterSale("aktiv", hit, rest, false)
        }
        return AfterSale("aktiv", hit, priceCents, true)
    }

    /** Wie JS encodeURIComponent: UTF-8, unreservierte Zeichen bleiben, alles andere %XX (Großbuchstaben). */
    fun encodeUriComponent(s: String): String {
        val sb = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if (c < 128 && UNRESERVED.indexOf(c.toChar()) >= 0) sb.append(c.toChar())
            else sb.append('%').append(String.format(Locale.ROOT, "%02X", c))
        }
        return sb.toString()
    }

    fun listingLink(channelId: String, cmUrl: String?, nameEn: String?, setCode: String?): String? {
        if (channelId == "cardmarket") {
            if (!cmUrl.isNullOrEmpty()) return cmUrl
            val q = listOfNotNull(nameEn?.takeIf { it.isNotEmpty() }, setCode?.takeIf { known(it) }).joinToString(" ")
            return CM_SEARCH + encodeUriComponent(q)
        }
        return LINKS[channelId]
    }

    fun channelShort(channelId: String, name: String?): String =
        FIXED_SHORT[channelId] ?: (name ?: "").trim().take(2).uppercase(Locale.ROOT).ifEmpty { "??" }

    fun rowTitle(channelId: String, title: String?, liveItems: List<Item>): String {
        if (channelId == "cardmarket") {
            val groups = groupItems(liveItems)
            if (groups.isEmpty()) return "(ohne Karten)"
            return "${groups.sumOf { it.count }}× ${cardmarketProduct(groups[0])}"
        }
        return if (title != null && title.isNotBlank()) title else "(ohne Titel)"
    }
    fun rowTitle(l: Head, liveItems: List<Item>): String = rowTitle(l.channelId, l.title, liveItems)

    fun sortListings(listings: List<Head>): List<Head> = listings.sortedWith(Comparator<Head> { a, b ->
        var c = b.listedOn.compareTo(a.listedOn)
        if (c == 0) c = (b.createdAt ?: "").compareTo(a.createdAt ?: "")
        if (c == 0) c = a.listingId.compareTo(b.listingId)
        c
    })

    fun listingMarks(
        listings: List<Head>, items: List<Item>, copyLive: (String) -> Boolean,
        saleStatusOf: (String) -> String?, suggestionOf: (String) -> Long?,
    ): Map<String, Marks> {
        val active = listings.filter { isActive(it) }.associateBy { it.listingId }
        val liveItems = items.filter { !it.deleted }
        val byCopy = HashMap<String, MutableList<String>>()
        for (item in liveItems) if (item.listingId in active) byCopy.getOrPut(item.copyId) { ArrayList() }.add(item.listingId)
        val out = LinkedHashMap<String, Marks>()
        for (l in listings) {
            val act = isActive(l)
            val also = HashSet<String>()
            var missing = false
            var sugg = 0L
            if (act) {
                for (item in liveItems) {
                    if (item.listingId != l.listingId) continue
                    for (other in byCopy[item.copyId] ?: emptyList<String>()) if (other != l.listingId) also.add(active.getValue(other).channelName)
                    if (copyLive(item.copyId)) sugg += suggestionOf(item.copyId) ?: 0L else missing = true
                }
            }
            val saleId = l.saleId
            out[l.listingId] = Marks(
                alsoOn = also.sorted(),
                missing = missing,
                underSuggestion = act && sugg > 0 && sugg * 100 >= l.priceCents * 120,
                saleCancelled = l.status == "verkauft" && saleId != null && saleStatusOf(saleId) == "storniert",
            )
        }
        return out
    }

    fun activeByCopy(listings: List<Head>, items: List<Item>): Map<String, List<Offer>> {
        val active = listings.filter { isActive(it) }.associateBy { it.listingId }
        val out = LinkedHashMap<String, MutableList<Offer>>()
        for (item in items) {
            if (item.deleted) continue
            val l = active[item.listingId] ?: continue
            out.getOrPut(item.copyId) { ArrayList() }.add(Offer(l.listingId, l.channelId, l.channelName, l.priceCents))
        }
        return out.mapValues { (_, v) -> v.sortedWith(compareBy<Offer> { it.channelName }.thenBy { it.listingId }) }
    }

    fun offeredText(offers: List<Offer>): String? =
        if (offers.isEmpty()) null
        else "angeboten auf " + offers.joinToString(", ") { "${it.channelName} für ${SalesMath.euroCentsText(it.priceCents)}" }

    fun copyBadges(offers: List<Offer>): List<String> = offers.map { channelShort(it.channelId, it.channelName) }.distinct().sorted()

    fun cleanupAfterSale(listings: List<Head>, items: List<Item>, soldCopyIds: Collection<String>, exceptListingId: String?): Cleanup {
        val sold = soldCopyIds.toSet()
        val remove = ArrayList<RemoveItem>()
        val end = ArrayList<String>()
        val remind = ArrayList<Remind>()
        for (l in listings.filter { isActive(it) && it.listingId != exceptListingId }.sortedBy { it.listingId }) {
            val live = items.filter { it.listingId == l.listingId && !it.deleted }
            val hit = live.map { it.copyId }.filter { it in sold }.sorted()
            if (hit.isEmpty()) continue
            hit.forEach { remove += RemoveItem(l.listingId, it) }
            if (hit.size == live.size) end += l.listingId
            remind += Remind(l.listingId, l.channelName, rowTitle(l, live), l.externalUrl)
        }
        return Cleanup(remove, end, remind)
    }

    fun listingsSummary(listings: List<Head>, items: List<Item>): Summary {
        val act = listings.filter { isActive(it) }
        val ids = act.map { it.listingId }.toSet()
        return Summary(act.size, items.count { !it.deleted && it.listingId in ids }, act.sumOf { it.priceCents })
    }
    fun summaryText(s: Summary): String =
        "${s.listings} ${if (s.listings == 1) "Angebot" else "Angebote"} · ${s.cards} ${if (s.cards == 1) "Karte" else "Karten"} · ${SalesMath.euroCentsText(s.priceCents)}"
    fun startText(n: Int): String = "Angebote: $n aktiv"

    fun daysSince(listedOn: String, today: String): Int =
        maxOf(0, ChronoUnit.DAYS.between(LocalDate.parse(listedOn.take(10)), LocalDate.parse(today.take(10))).toInt())
    fun sinceText(days: Int): String = if (days <= 0) "seit heute" else if (days == 1) "seit 1 Tag" else "seit $days Tagen"

    fun suggestionSum(values: List<Long?>): Long? = if (values.all { it == null }) null else values.sumOf { it ?: 0L }

    fun imageUrls(items: List<Item>): List<String> = groupItems(items).mapNotNull { g -> g.imageUrl?.takeIf { it.isNotEmpty() } }.distinct()
    fun imagesText(saved: Int, total: Int): String = when {
        total == 0 -> "Keine Bilder vorhanden."
        saved == total -> "$total ${if (total == 1) "Bild" else "Bilder"} gespeichert"
        else -> "$saved von $total Bildern gespeichert"
    }
}
