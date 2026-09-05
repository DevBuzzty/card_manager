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
) {
    fun printingKey() = "$cardId|$setCode|$language|$rarity"
}

fun CardRow.printingKey() = "$id|$setCode|$language|${rarity ?: "Unknown"}"
