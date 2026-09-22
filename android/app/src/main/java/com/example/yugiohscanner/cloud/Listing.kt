package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SalesMath

/** Spec H3a §4.2 -- Zeile aus listings. channel_name ist die Momentaufnahme beim Anlegen (wie sales.channel_name). */
data class ListingRow(
    val listingId: String, val channelId: String, val channelName: String, val title: String?, val description: String?,
    val price: Double, val status: String, val listedOn: String, val saleId: String?, val externalUrl: String?,
    val note: String?, val createdAt: String?, val deleted: Boolean,
) {
    val priceCents: Long get() = SalesMath.toCents(price) ?: 0L
    fun head(): ListingText.Head =
        ListingText.Head(listingId, channelId, channelName, title, priceCents, status, listedOn, createdAt, saleId, externalUrl, deleted)
}

/** Spec H3a §4.2 -- Position (Momentaufnahme des Exemplars beim Anlegen; name = Anzeigename, Abweichung 3). */
data class ListingItemRow(
    val listingId: String, val copyId: String, val cardId: String, val setCode: String, val language: String,
    val rarity: String, val edition: String, val condition: String, val name: String?, val imageUrl: String?, val deleted: Boolean,
) {
    fun item(): ListingText.Item = ListingText.Item(copyId, cardId, name, setCode, language, rarity, edition, condition,
        imageUrl = imageUrl, listingId = listingId, deleted = deleted)
}

/** Voll neu geladener Stand (SideStores.listings): alle nicht gelöschten Angebote, nur lebende Positionen. */
data class ListingsData(val listings: List<ListingRow>, val items: List<ListingItemRow>) {
    fun heads(): List<ListingText.Head> = listings.map { it.head() }
    fun lineItems(): List<ListingText.Item> = items.map { it.item() }
    fun liveItemsOf(listingId: String): List<ListingItemRow> = items.filter { it.listingId == listingId && !it.deleted }
    fun byCopy(): Map<String, List<ListingText.Offer>> = ListingText.activeByCopy(heads(), lineItems())
}

/** Eingabe für ein neues Angebot. [items] ist die Momentaufnahme (Name = Anzeigename). */
data class NewListing(
    val channelId: String, val channelName: String, val listedOn: String, val priceCents: Long,
    val title: String?, val description: String?, val externalUrl: String?, val note: String?, val items: List<ListingText.Item>,
)
