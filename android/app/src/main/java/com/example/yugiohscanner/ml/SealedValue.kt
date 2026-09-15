package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SealedItem
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * Spec G3 §6 -- Wert, Veraltung, Art-Bezeichnung und Listenreihenfolge des Sealed-Bestands.
 * ZWILLING: desktop/electron/sealed-value.cjs. Beide laufen gegen docs/fixtures/portfolio/sealed-value.json.
 * Wer eine Seite aendert, aendert beide. Gerundet wird nur in der Anzeige.
 */
object SealedValue {
    private const val DAY_MS = 86_400_000L
    private const val STALE_DAYS = 30
    private val ZONE = Regex("""(Z|[+-]\d{2}:\d{2})$""")
    private val VALID_TS = Regex("""^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$""")

    /** Reihenfolge = Reihenfolge der Schluessel; die Schluessel sind die Werte der Spalte sealed_items.kind. */
    val KIND_LABELS: Map<String, String> = linkedMapOf(
        "display" to "Display",
        "booster" to "Booster",
        "tin" to "Tin",
        "deck" to "Deck",
        "special" to "Special Edition",
        "other" to "Sonstiges",
    )

    fun kindLabel(kind: String?): String = kind?.let { KIND_LABELS[it] } ?: "Sonstiges"

    fun lineValue(item: SealedItem): Double? = item.price?.let { item.quantity * it }

    /** Summe quantity x price ueber lebende Zeilen mit Preis. */
    fun sealedValue(items: List<SealedItem>): Double {
        var sum = 0.0
        for (item in items) {
            if (item.deleted) continue
            val p = item.price ?: continue
            sum += item.quantity * p
        }
        return sum
    }

    /** Liest lokal "2026-09-15 05:00:03" (naive UTC) und Cloud "2026-09-15T05:00:03.123456+00:00". */
    // ZWILLING: desktop/electron/sealed-value.cjs.
    fun toUtcMillis(ts: String?): Long? {
        if (ts.isNullOrBlank()) return null
        var s = ts.trim()
        if (!VALID_TS.containsMatchIn(s)) return null
        s = s.replaceFirst(' ', 'T')
        if (!ZONE.containsMatchIn(s)) s += "Z"
        return try {
            OffsetDateTime.parse(s).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            null
        }
    }

    /** "aelter als 30 Tage": genau 30 Tage ist noch nicht veraltet. */
    fun isPriceStale(priceUpdatedAt: String?, nowMs: Long): Boolean {
        val t = toUtcMillis(priceUpdatedAt) ?: return false
        return nowMs - t > STALE_DAYS * DAY_MS
    }

    /** Zeilensumme absteigend, Zeilen ohne Preis ans Ende, dann Name, dann sealedId. */
    fun sortSealed(items: List<SealedItem>): List<SealedItem> = items.sortedWith(Comparator { a, b ->
        val va = lineValue(a)
        val vb = lineValue(b)
        when {
            va != null && vb == null -> -1
            va == null && vb != null -> 1
            va != null && vb != null && va != vb -> vb.compareTo(va)
            else -> a.name.compareTo(b.name).takeIf { it != 0 } ?: a.sealedId.compareTo(b.sealedId)
        }
    })
}
