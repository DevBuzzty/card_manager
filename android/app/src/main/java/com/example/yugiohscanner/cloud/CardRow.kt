package com.example.yugiohscanner.cloud

// One printing of a card, mirrored from the Supabase `cards` table.
// Plain data class (parsed via org.json) — no kotlinx.serialization dependency.
data class CardRow(
    val id: String,
    val setCode: String,
    val language: String,
    val name: String?,
    val imageUrl: String?,
    val rarity: String?,
    val quantity: Int,
    val price: Double?,
)
