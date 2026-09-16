package com.example.yugiohscanner.ml

/** Katalogdaten einer Hauptkarte fuer die Legalitaet; ban_* = "forbidden" | "limited" | "semi" | null. */
data class LegalityInfo(val name: String?, val type: String?, val banTcg: String?, val banOcg: String?)

/** aliases: Artwork-Passcode -> Haupt-Passcode; cards: Haupt-Passcode -> Info; builtAt = Baudatum des Katalogs. */
data class LegalityCatalog(val aliases: Map<String, String>, val cards: Map<String, LegalityInfo>, val builtAt: String? = null)

/** Deckzeile fuer die Legalitaet (gespeicherter Stand; mehrere Zeilen je Passcode erlaubt). */
data class LegalityCard(val cardId: String, val name: String?, val count: Int, val section: String)

/** rule null = Warnung; cardId = Haupt-Passcode oder null. */
data class LegalityIssue(val rule: Int?, val cardId: String?, val text: String)

data class LegalityResult(val legal: Boolean, val violations: List<LegalityIssue>, val warnings: List<LegalityIssue>)

/**
 * Spec E3 §4/§5 -- Format, Legalitaetsregeln TCG/OCG, Badge-Texte, Banlist-Stufe und Kopien-Grenze.
 * ZWILLING: desktop/src/utils/deckLegality.js. Beide laufen gegen docs/fixtures/decks/legality.json.
 * Wer eine Seite aendert, aendert beide. (JS deckLegality <-> Kotlin check.)
 */
object DeckLegality {
    val FORMATS = listOf("tcg", "ocg", "free")
    val FORMAT_LABELS = mapOf("tcg" to "TCG", "ocg" to "OCG", "free" to "Frei")
    const val CATALOG_MISSING_BANLIST = "Katalog fehlt – Banlist unbekannt"
    const val COPY_LIMIT = "Höchstens 3 Kopien je Karte"
    const val FORMAT_SAVE_FAILED = "Format konnte nicht gespeichert werden"
    /** Anzeige der Banlist-Stufe an der Kartenzeile (rot "Verboten", orange "1", gelb "2"). */
    val BAN_LABELS = mapOf("forbidden" to "Verboten", "limited" to "1", "semi" to "2")

    private val SECTION_ORDER = listOf("main", "extra", "side")
    private const val MAX_COPIES = 3
    private val BUILT_AT = Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})")

    /** Spec E3 §8: fehlt die Spalte format oder steht Unbekanntes darin -> TCG. */
    fun normalizeFormat(format: String?): String = if (format != null && format in FORMATS) format else "tcg"

    private fun mainIdOf(passcode: String, catalog: LegalityCatalog?): String =
        if (catalog != null) DeckImport.canonicalPasscode(passcode, catalog.aliases) else passcode

    /** Banlist-Stufe einer Deckkarte im Format; null = uneingeschraenkt, Frei oder unbekannt. */
    fun banOf(passcode: String, format: String?, catalog: LegalityCatalog?): String? {
        val f = normalizeFormat(format)
        if (f == "free" || catalog == null) return null
        val info = catalog.cards[mainIdOf(passcode, catalog)] ?: return null
        val ban = if (f == "ocg") info.banOcg else info.banTcg
        return ban?.takeIf { it in BAN_LABELS }
    }

    private class Group(val id: String, val name: String, val info: LegalityInfo?) {
        var count = 0
        val sections = mutableListOf<String>()
    }

    fun check(cards: List<LegalityCard>, format: String?, catalog: LegalityCatalog?): LegalityResult {
        val f = normalizeFormat(format)
        if (f == "free") return LegalityResult(true, emptyList(), emptyList())
        val rows = SECTION_ORDER.flatMap { s -> cards.filter { it.section == s && it.count > 0 } }
        fun total(s: String) = rows.filter { it.section == s }.sumOf { it.count }
        val violations = mutableListOf<LegalityIssue>()
        val warnings = mutableListOf<LegalityIssue>()

        val main = total("main")
        val extra = total("extra")
        val side = total("side")
        if (main < 40 || main > 60) violations.add(LegalityIssue(1, null, "Main Deck: $main Karten (erlaubt 40–60)"))
        if (extra > 15) violations.add(LegalityIssue(2, null, "Extra Deck: $extra Karten (höchstens 15)"))
        if (side > 15) violations.add(LegalityIssue(3, null, "Side Deck: $side Karten (höchstens 15)"))
        if (catalog == null) warnings.add(LegalityIssue(null, null, CATALOG_MISSING_BANLIST))

        // Je Haupt-Passcode: erster Name (gespeicherter Deckkartenname, sonst Katalog, sonst Passcode), Summe, Abschnitte.
        val groups = LinkedHashMap<String, Group>()
        for (c in rows) {
            val id = mainIdOf(c.cardId, catalog)
            val g = groups.getOrPut(id) {
                val info = catalog?.cards?.get(id)
                Group(id, c.name?.takeIf { it.isNotEmpty() } ?: info?.name?.takeIf { it.isNotEmpty() } ?: id, info)
            }
            g.count += c.count
            if (c.section !in g.sections) g.sections.add(c.section)
        }

        val rule5 = mutableListOf<LegalityIssue>()
        val rule6 = mutableListOf<LegalityIssue>()
        for (g in groups.values) {
            if (catalog != null && g.info == null) warnings.add(LegalityIssue(null, g.id, "Banlist unbekannt: Passcode ${g.id}"))
            val type = g.info?.type
            if (catalog != null && !type.isNullOrEmpty()) {
                val home = DeckImport.deckSectionFor(type)
                if ("main" in g.sections && home == "extra") violations.add(LegalityIssue(4, g.id, "${g.name} im Main Deck gehört ins Extra Deck"))
                if ("extra" in g.sections && home == "main") violations.add(LegalityIssue(4, g.id, "${g.name} im Extra Deck gehört ins Main Deck"))
            }
            val ban = if (catalog != null && g.info != null) banOf(g.id, f, catalog) else null
            when {
                ban == "forbidden" -> rule6.add(LegalityIssue(6, g.id, "${g.name} ist verboten"))
                ban == "limited" && g.count > 1 -> rule6.add(LegalityIssue(6, g.id, "${g.name}: ${g.count} Kopien (limitiert 1)"))
                ban == "semi" && g.count > 2 -> rule6.add(LegalityIssue(6, g.id, "${g.name}: ${g.count} Kopien (semi-limitiert 2)"))
                g.count > MAX_COPIES -> rule5.add(LegalityIssue(5, g.id, "${g.name}: ${g.count} Kopien (höchstens 3)"))
            }
        }
        violations.addAll(rule5)
        violations.addAll(rule6)
        return LegalityResult(violations.isEmpty(), violations, warnings)
    }

    fun violationCountText(n: Int): String = if (n == 1) "1 Verstoß" else "$n Verstöße"

    /** "Legal" | "Legal · 1 Warnung" | "Legal · 2 Warnungen" | "1 Verstoß" | "3 Verstöße" | "Frei". */
    fun badgeText(result: LegalityResult, format: String?): String {
        if (normalizeFormat(format) == "free") return "Frei"
        if (result.violations.isNotEmpty()) return violationCountText(result.violations.size)
        val w = result.warnings.size
        return if (w == 0) "Legal" else "Legal · $w ${if (w == 1) "Warnung" else "Warnungen"}"
    }

    /** Farbe des Badges: "free" grau, "legal" gruen, "warn" gelb, "crit" rot. */
    fun badgeKind(result: LegalityResult, format: String?): String = when {
        normalizeFormat(format) == "free" -> "free"
        result.violations.isNotEmpty() -> "crit"
        result.warnings.isNotEmpty() -> "warn"
        else -> "legal"
    }

    /** "Banlist-Stand: TT.MM.JJJJ" aus built_at (UTC-Datum wie gespeichert); ohne gueltiges Datum null. */
    fun banlistDateText(builtAt: String?): String? {
        val m = BUILT_AT.find(builtAt ?: "") ?: return null
        val (y, mo, d) = m.destructured
        return "Banlist-Stand: $d.$mo.$y"
    }

    /**
     * Spec E3 §5: darf eine weitere Kopie von [passcode] ins Deck? TCG/OCG: nicht, wenn die Karte (Haupt-Passcode, ueber
     * alle Abschnitte) danach mehr als 3 Kopien haette; Frei immer. Die Banlist blockiert nie. [aliases] null = ohne Zuordnung.
     */
    fun canAddCopy(deckCards: List<LegalityCard>, passcode: String, format: String?, aliases: Map<String, String>?): Boolean {
        if (normalizeFormat(format) == "free") return true
        val id = DeckImport.canonicalPasscode(passcode, aliases)
        val have = deckCards.filter { DeckImport.canonicalPasscode(it.cardId, aliases) == id }.sumOf { maxOf(0, it.count) }
        return have + 1 <= MAX_COPIES
    }
}
