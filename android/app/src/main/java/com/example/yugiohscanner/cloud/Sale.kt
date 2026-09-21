package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.SalesMath

/** Spec H2 §4.2/§8 -- ein Verkaufskanal (supabase/sales_schema.sql, Tabelle sale_channels). */
data class SaleChannel(
    val channelId: String,
    val name: String,
    val feePercent: Double,
    val builtin: Boolean,
    val sort: Int,
)

/** Spec H2 §4.2 -- eine Position (Karte) in einem Verkauf (Tabelle sale_items). */
data class SaleItemRow(
    val saleId: String,
    val copyId: String,
    val valueAtSale: Double,
    val share: Double,
    val wasForSale: Boolean,
    val cardId: String,
    val setCode: String,
    val language: String,
    val rarity: String,
    val edition: String,
    val condition: String,
    val name: String?,
    val imageUrl: String?,
    val deleted: Boolean,
)

/** Eingabe fuer book_sale/update_sale -- die vom Nutzer editierbaren Kopf-Felder eines Verkaufs. */
data class SaleHeadInput(
    val soldOn: String,
    val channelId: String,
    val channelName: String,
    val gross: Double,
    val fees: Double?,
    val shipping: Double?,
    val note: String?,
)

/**
 * Spec H2 §4.2/§8 -- vollstaendig neu geladener Stand (SideStores.sales, wie SealedRepository: klein,
 * kein updated_at-Delta). [notes] haelt die Notiz getrennt von SalesMath.SaleHead (das keine Notiz
 * kennt -- gemeinsam mit dem JS-Zwilling). [soldIn] ist card_copies.sold_in je copy_id, fuer
 * SalesMath.countedItems/listValues/totals (Doppelverkauf-Pruefung).
 */
data class SalesData(
    val sales: List<SalesMath.SaleHead>,
    val notes: Map<String, String?>,
    val items: List<SaleItemRow>,
    val soldIn: Map<String, String?>,
    val channels: List<SaleChannel>,
) {
    fun soldInOf(id: String): String? = soldIn[id]

    fun lines(): List<SalesMath.SaleLine> =
        items.map { SalesMath.SaleLine(it.saleId, it.copyId, it.valueAtSale, it.share, it.deleted) }

    /** Netto/Marktwert EINES Verkaufs -- delegiert an SalesMath.listValues. */
    fun listValues(sale: SalesMath.SaleHead): SalesMath.ListValues = SalesMath.listValues(sale, lines(), ::soldInOf)
}
