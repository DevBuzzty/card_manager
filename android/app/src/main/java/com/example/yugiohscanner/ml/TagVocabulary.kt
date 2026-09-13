package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CopyRow

/**
 * Tag-Vorschlaege ueber alle lebenden Exemplare -- aus dem Speicher statt ueber einen eigenen
 * Netzaufruf durch alle Zeilen. Dieselbe Regel wie das abgeloeste CollectionRepository.listTags():
 * Reihenfolge created_at, copy_id (die Schreibweise des aeltesten Exemplars gewinnt, weil Tags.add
 * Dubletten ohne Gross/klein erkennt), Zerlegen nur ueber Tags.parse, am Ende ohne Gross/klein sortiert.
 */
object TagVocabulary {
    fun from(copies: List<CopyRow>): List<String> {
        var result = emptyList<String>()
        for (c in copies.filter { !it.deleted && it.tags != null }.sortedWith(UnsortedCopies.ORDER)) {
            for (t in Tags.parse(c.tags)) result = Tags.add(result, t)
        }
        return result.sortedWith(String.CASE_INSENSITIVE_ORDER)
    }
}
