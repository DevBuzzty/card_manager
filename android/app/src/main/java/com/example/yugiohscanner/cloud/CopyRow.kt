package com.example.yugiohscanner.cloud

// One physical copy, mirrored from the Supabase `card_copies` table (Spec A).
data class CopyRow(
    val copyId: String,
    val cardId: String,
    val setCode: String,
    val language: String,
    val rarity: String,
    val edition: String,     // first | unlimited | limited | unknown
    val condition: String,   // MT NM EX GD LP PL PO
    val deleted: Boolean,
    // Spec B1: Standort (Behaelter/Seite/Tasche) und Tags/Notiz. Nullbar, weil ein aelterer
    // Server-Stand diese Spalten noch nicht liefert.
    val containerId: String?,
    val page: Int?,
    val slot: Int?,
    val tags: String?,      // JSON-Array-Text, ueber Tags.parse lesen -- nie selbst zerlegen
    val note: String?,
) {
    fun printingKey() = "$cardId|$setCode|$language|$rarity"
}

fun CardRow.printingKey() = "$id|$setCode|$language|${rarity ?: "Unknown"}"
