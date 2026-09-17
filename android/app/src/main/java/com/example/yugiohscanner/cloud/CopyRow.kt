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
    // Spec B1: Standort (Behaelter/Seite/Fach) und Tags/Notiz. Nullbar, weil ein aelterer
    // Server-Stand diese Spalten noch nicht liefert.
    val containerId: String?,
    val page: Int?,
    val slot: Int?,
    val tags: String?,      // JSON-Array-Text, ueber Tags.parse lesen -- nie selbst zerlegen
    val note: String?,
    // NUR-LESE-FELD. Der Server stempelt created_at selbst; kein Schreibweg des Handys darf es
    // mitschicken. Dass das haelt, haengt nicht an Disziplin, sondern an der Bauart von
    // CollectionRepository: insertCopies() und patchCopy() bauen ihr JSON Feld fuer Feld aus
    // einzelnen Werten -- eine CopyRow wird NIRGENDS als Ganzes serialisiert. Wer das aendert
    // (etwa eine allgemeine toJson()), muss created_at ausdruecklich auslassen.
    //
    // Da ist es, damit die unsortierte Liste ohne zweite Netzabfrage in DERSELBEN Reihenfolge
    // abgeleitet werden kann, in der sie bisher vom Server kam (UnsortedCopies.from). Der Desktop
    // macht es genauso: copies.cjs#listAllCopies waehlt created_at mit aus.
    val createdAt: String? = null,
    // NUR-LESE-FELD wie createdAt: der Server stempelt es; Stichtag des Delta-Abgleichs (Spec §4.3).
    val updatedAt: String? = null,
    // Spec H1 §6: Exemplar steht auf der Verkaufsliste. Geschrieben nur ueber CollectionRepository.setForSale.
    val forSale: Boolean = false,
) {
    fun printingKey() = "$cardId|$setCode|$language|$rarity"
}

fun CardRow.printingKey() = "$id|$setCode|$language|${rarity ?: "Unknown"}"
