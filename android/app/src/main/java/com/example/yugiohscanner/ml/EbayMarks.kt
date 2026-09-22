package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Spec H3b §4.4/§5.4 -- eBay-Marken und Einrichtungs-Check-Liste. ZWILLING von desktop/src/utils/ebayMarks.js,
 * gemeinsame Fixture docs/fixtures/ebay/marks.json. Wer eine Fassung ändert, ändert beide.
 * Namensabweichungen: JS-status `undefined` = [StatusState.Loading], `null` = [StatusState.None]; Felder camelCase.
 */
object EbayMarks {
    const val MAX_OWN_PHOTOS = 12

    data class Mark(val kind: String, val text: String, val url: String?, val retry: Boolean)
    data class ListingHead(val channelId: String, val status: String, val deleted: Boolean)
    data class Row(val environment: String, val state: String, val itemUrl: String?, val error: String?)
    data class Status(
        val environment: String, val connected: Boolean, val refreshExpiresAt: String?,
        val hasPaymentPolicy: Boolean, val paymentPolicyName: String?,
        val hasFulfillmentPolicy: Boolean, val fulfillmentPolicyName: String?,
        val hasReturnPolicy: Boolean, val returnPolicyName: String?,
        val hasLocation: Boolean, val locationKey: String?,
    )
    sealed interface StatusState {
        data object Loading : StatusState
        data object None : StatusState
        data class Known(val status: Status) : StatusState
    }
    data class SetupItem(val label: String, val ok: Boolean)

    private val WAITING = Mark("wartet", "wartet auf eBay", null, false)
    private val HTTPS = Regex("^https://", RegexOption.IGNORE_CASE)

    fun webUrl(u: String?): String? = u?.trim()?.takeIf { HTTPS.containsMatchIn(it) }

    fun mark(l: ListingHead, row: Row?, st: StatusState): Mark? {
        if (l.channelId != "ebay") return null
        if (st is StatusState.Loading) return Mark("laden", "…", null, false)
        val active = l.status == "aktiv" && !l.deleted
        val s = (st as? StatusState.Known)?.status
        if (s == null || row == null) return if (active) WAITING else null
        if (row.environment != s.environment) {
            return if (active) WAITING else Mark("andere", "auf eBay beendet (andere Umgebung)", null, false)
        }
        return when (row.state) {
            "online" -> Mark("online", "auf eBay online", webUrl(row.itemUrl), false)
            "fehler" -> Mark("fehler", "eBay-Fehler: ${row.error?.takeIf { it.isNotEmpty() } ?: "unbekannt"}", webUrl(row.itemUrl), active)
            "beendet" -> Mark("beendet", "auf eBay beendet", null, false)
            else -> if (active) WAITING else null
        }
    }

    fun setupItems(s: Status?): List<SetupItem> {
        fun named(label: String, ok: Boolean, name: String?) =
            SetupItem(if (ok && !name.isNullOrEmpty()) "$label: $name" else label, ok)
        return listOf(
            SetupItem("Mit eBay verbunden", s?.connected == true),
            named("Zahlungsrichtlinie", s?.hasPaymentPolicy == true, s?.paymentPolicyName),
            named("Versandrichtlinie", s?.hasFulfillmentPolicy == true, s?.fulfillmentPolicyName),
            named("Rücknahmerichtlinie", s?.hasReturnPolicy == true, s?.returnPolicyName),
            named("Artikelstandort", s?.hasLocation == true, s?.locationKey),
        )
    }
    fun setupOk(s: Status?): Boolean = setupItems(s).all { it.ok }

    /** Spec §4.3: 30 Tage vor Ablauf ein Hinweis. [today] = "YYYY-MM-DD" (lokal). */
    fun expiryText(s: Status?, today: String): String? {
        if (s == null || !s.connected || s.refreshExpiresAt.isNullOrEmpty()) return null
        val day = s.refreshExpiresAt.take(10)
        val days = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(day))
        if (days > 30) return null
        return "Verbindung läuft am ${day.substring(8, 10)}.${day.substring(5, 7)}.${day.substring(0, 4)} ab – bitte neu verbinden."
    }

    fun photoCountText(n: Int): String = "$n/$MAX_OWN_PHOTOS Fotos"
}
