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
    val type: String? = null,
    val desc: String? = null,
    val atk: Int? = null,
    val def: Int? = null,
    val level: Int? = null,
    val race: String? = null,
    val attribute: String? = null,
    // Nur fuer den Delta-Abgleich des Speichers (Spec §4.2): eine geloeschte Zeile muss ankommen,
    // damit sie lokal verschwindet. Beide Felder werden NUR gelesen; kein Schreibweg sendet sie.
    val deleted: Boolean = false,
    val updatedAt: String? = null,
    // Spec G1 §4.2: Quellenfamilie des aktuellen Preises (0 YGOPRODeck, 1 Cardmarket, 2 manuell). Nur gelesen.
    val priceLocked: Int = 0,
)
