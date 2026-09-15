package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CacheState
import com.example.yugiohscanner.cloud.SealedItem

/**
 * Spec G3 §8 -- ob und mit welchen Werten der Start den Tageswert schreibt. Der Aufrufer laedt die
 * Sealed-Liste an diesem Start neu (refreshAndWait). Ohne geladene Liste oder mit Ladefehler an diesem Start
 * wird KEIN Tageswert geschrieben -- sonst stuende ein Tag ohne Sealed-Anteil im Wertverlauf.
 */
object SealedSnapshot {
    data class Values(val total: Double, val sealed: Double)

    fun decide(cardTotal: Double, sealed: CacheState<List<SealedItem>>): Values? {
        val items = sealed.value ?: return null
        if (sealed.error != null) return null
        val s = SealedValue.sealedValue(items)
        return Values(cardTotal + s, s)
    }
}
