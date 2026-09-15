package com.example.yugiohscanner.cloud

/**
 * Spec G3 §4.1 -- eine Zeile aus `sealed_items` (supabase/sealed_items_schema.sql). `price` ist der
 * Cardmarket-Trend pro Einheit, `priceUpdatedAt`/`createdAt` sind die rohen Cloud-Zeitstempel.
 */
data class SealedItem(
    val sealedId: String,
    val cmProductId: Long,
    val name: String,
    val kind: String,
    val quantity: Int,
    val price: Double?,
    val priceUpdatedAt: String?,
    val createdAt: String? = null,
    val deleted: Boolean = false,
)
