package com.example.yugiohscanner.ml

/**
 * Spec I §5.2 -- Logik des Verkaufswegs ohne Oberflaeche: Kanal wie beim letzten Mal (Punkt 2),
 * naechster sinnvoller Schritt (Punkt 5), Fehler am Feld mit einer Handlung, die sie behebt (Punkt 6).
 * ZWILLING: desktop/src/utils/saleFlow.js, Fixture docs/fixtures/sales/sale-flow.json.
 */
object SaleFlow {

    /** Kanal des juengsten nicht stornierten Verkaufs (nach soldOn; bei gleichem Tag der zuerst gelieferte). */
    fun lastChannel(sales: List<SalesMath.SaleHead>, fallback: String = "cardmarket"): String {
        var best: SalesMath.SaleHead? = null
        for (s in sales) {
            if (s.status == "storniert" || s.deleted) continue
            if (best == null || s.soldOn > best.soldOn) best = s
        }
        return best?.channelId ?: fallback
    }

    const val NAECHSTES = "naechstes-exemplar"
    const val ANGEBOT_ANSEHEN = "angebot-ansehen"
    const val LISTE_ANSEHEN = "verkaufsliste-ansehen"
    const val FERTIG = "fertig"
    val NEXT_STEP_LABELS = mapOf(
        NAECHSTES to "Nächstes Exemplar", ANGEBOT_ANSEHEN to "Angebot ansehen",
        LISTE_ANSEHEN to "Verkaufsliste ansehen", FERTIG to "Fertig",
    )

    /** [way]: "verkauft" | "angebot" | "verkaufsliste"; [remaining]: weitere vorgemerkte Exemplare derselben Karte. */
    fun nextSteps(way: String, remaining: Int, listingId: String?): List<String> = buildList {
        if (way == "angebot" && listingId != null) add(ANGEBOT_ANSEHEN)
        if (way == "verkaufsliste") add(LISTE_ANSEHEN)
        if (way != "verkaufsliste" && remaining > 0) add(NAECHSTES)
        add(FERTIG)
    }

    data class Fix(val label: String, val field: String, val cents: Long? = null, val value: String? = null)
    data class FieldError(val field: String, val text: String, val fix: Fix?)

    /** "4,50" oder "4.50" -> Zahl; leer -> null; kaputt -> NaN. */
    private fun parseEuro(s: String?): Double? {
        val t = s?.trim().orEmpty()
        if (t.isEmpty()) return null
        return t.replace(',', '.').toDoubleOrNull() ?: Double.NaN
    }

    private val DATE = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val HTTP = Regex("^https?://", RegexOption.IGNORE_CASE)

    private fun suggestFix(field: String, cents: Long?) =
        cents?.let { Fix("Vorschlag ${SalesMath.euroCentsText(it)} übernehmen", field, cents = it) }

    fun validateSale(gross: String, fees: String, shipping: String, soldOn: String, suggestionCents: Long?, today: String): List<FieldError> =
        buildList {
            val g = parseEuro(gross)
            if (g == null) add(FieldError("gross", "Der Preis fehlt.", suggestFix("gross", suggestionCents)))
            else if (g.isNaN() || g < 0) add(FieldError("gross", "Der Preis muss 0 € oder mehr sein.", suggestFix("gross", suggestionCents)))
            val optional = listOf(
                Triple("fees", fees, "Gebühren müssen 0 € oder mehr sein."),
                Triple("shipping", shipping, "Versand muss 0 € oder mehr sein."),
            )
            for ((field, value, text) in optional) {
                val v = parseEuro(value)
                if (v != null && (v.isNaN() || v < 0)) add(FieldError(field, text, Fix("Auf 0 € setzen", field, cents = 0)))
            }
            if (!DATE.matches(soldOn)) add(FieldError("sold_on", "Ungültiges Datum.", Fix("Heute", "sold_on", value = today)))
        }

    fun validateListing(price: String, url: String, suggestionCents: Long?): List<FieldError> = buildList {
        val p = parseEuro(price)
        if (p == null || p.isNaN() || p <= 0) add(FieldError("price", "Der Angebotspreis muss über 0 € liegen.", suggestFix("price", suggestionCents)))
        val u = url.trim()
        if (u.isNotEmpty() && !HTTP.containsMatchIn(u)) {
            add(FieldError("url", "Der Link muss mit http:// oder https:// beginnen.", Fix("https:// ergänzen", "url", value = "https://$u")))
        }
    }
}
