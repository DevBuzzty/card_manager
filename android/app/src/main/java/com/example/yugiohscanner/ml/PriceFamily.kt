package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.ZoneOffset

/** Eine Zeile aus price_history (Variante base): Referenzpreis oder Verlaufspunkt (Spec G1 §4.2/§4.5). */
data class PriceRef(
    val cardId: String, val setCode: String, val language: String, val rarity: String,
    val day: String, val price: Double, val source: String,
) {
    fun key(): String = "$cardId|$setCode|$language|$rarity"
}

/**
 * Quellenfamilien (Spec G1 §4.2). MUSS desktop/electron/price-families.json gleichen -- PriceFamilyTest
 * vergleicht beide. ofLock ist der Zwilling von movers.cjs#familyOfLock.
 */
object PriceFamily {
    val BY_SOURCE: Map<String, String> = mapOf(
        "cm_bulk" to "cm", "cm_scrape" to "cm", "cloud" to "cm", "ygoprodeck" to "ygo", "manual" to "manual",
    )
    val LABELS: Map<String, String> = mapOf(
        "cm" to "Cardmarket", "ygo" to "YGOPRODeck", "manual" to "manuell", "unknown" to "unbekannt",
    )

    fun ofSource(source: String?): String = BY_SOURCE[source] ?: "unknown"

    fun ofLock(priceLocked: Int?): String = when (priceLocked ?: 0) {
        0 -> "ygo"
        1 -> "cm"
        2 -> "manual"
        else -> "unknown"
    }
}

/** "Heute" ist ueberall das UTC-Datum (Spec G1 §4.2). */
object UtcDay {
    fun today(): String = LocalDate.now(ZoneOffset.UTC).toString()
    fun add(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    fun formatDe(day: String): String = "${day.substring(8, 10)}.${day.substring(5, 7)}."
}
