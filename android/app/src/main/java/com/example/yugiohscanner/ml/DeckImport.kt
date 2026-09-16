package com.example.yugiohscanner.ml

import java.text.Normalizer

/** Katalogzeile fuer die Aufloesung (Handy: aus CatalogDb). image nur fuer das Anlegen, nicht fuer die Regel. */
data class CatalogNameRow(val id: String, val nameDe: String?, val nameEn: String?, val type: String?, val image: String? = null)

data class ImportCandidate(val passcode: String, val name: String, val type: String)

/** status: ok | ambiguous | suggest | notFound | unknownPasscode; source = Passcode (YDK/YDKE) bzw. Rohzeile. */
data class ImportRow(val status: String, val count: Int, val section: String, val source: String, val candidates: List<ImportCandidate>)

data class ResolvedImport(val catalogMissing: Boolean, val rows: List<ImportRow>, val unresolved: List<String>)

data class ImportCard(val cardId: String, val name: String, val count: Int, val section: String)

data class ImportCounts(val main: Int, val extra: Int, val side: Int)

/** skipped = Zeilen fuer die Notizen; skippedLabels = dieselben Zeilen fuer den Block "Nicht übernommen" (mit Grund). */
data class ImportPlan(
    val cards: List<ImportCard>, val counts: ImportCounts, val skipped: List<String>, val skippedLabels: List<String>, val notes: String?,
)

/** Ergebnis der Vorbereitung: entweder [error] (Lesefehler) oder [resolved]. */
data class PreparedImport(val error: String?, val resolved: ResolvedImport?)

/**
 * Spec E2 §4/§5 -- Namensaufloesung gegen den Offline-Katalog, Abschnittsregel, Vorschau-Plan, Notizen und Texte.
 * ZWILLING: desktop/src/utils/deckImport.js. Beide laufen gegen docs/fixtures/decks/import.json.
 * Wer eine Seite aendert, aendert beide.
 */
object DeckImport {
    const val CATALOG_MISSING = "Katalog fehlt – Namen können nicht aufgelöst werden"
    const val NOT_FOUND = "Nicht gefunden"
    const val DEFAULT_DECK_NAME = "Importiertes Deck"
    const val NOTES_HEAD = "Nicht übernommen beim Import:"
    const val AMBIGUOUS = "Mehrdeutig – bitte wählen"
    const val OPEN = "offen"

    private val EXTRA_TYPES = listOf("fusion", "synchro", "xyz", "link")
    private val MARKS = Regex("\\p{M}+")
    private val NON_ALNUM = Regex("[^\\p{L}\\p{N}]+")

    /** Typ enthaelt Fusion/Synchro/XYZ/Link (Gross/Klein egal) -> extra, sonst main. Auch fuer "Ziel: Deck". */
    fun deckSectionFor(type: String?): String {
        val t = (type ?: "").lowercase()
        return if (EXTRA_TYPES.any { t.contains(it) }) "extra" else "main"
    }

    /** Zeilenaktion: aus dem Side-Deck "→ Deck" (Main/Extra per Typ), sonst "→ Side". */
    fun moveTarget(section: String, type: String?): String = if (section == "side") deckSectionFor(type) else "side"

    fun moveLabel(section: String): String = if (section == "side") "→ Deck" else "→ Side"

    fun normalizeName(s: String?): String {
        val lower = (s ?: "").lowercase()
        val stripped = MARKS.replace(Normalizer.normalize(lower, Normalizer.Form.NFKD), "")
        return NON_ALNUM.replace(stripped.replace("ß", "ss"), " ").trim()
    }

    fun levenshtein(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) {
                cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            prev = cur
        }
        return prev[b.length]
    }

    fun unknownPasscodeText(passcode: String) = "Unbekannter Passcode $passcode"
    fun suggestionText(name: String) = "Meintest du $name?"
    fun ambiguousOptionText(c: ImportCandidate) = "${c.name} (${c.passcode})"
    fun failedText(message: String?) = "Import fehlgeschlagen: $message"
    fun countsText(counts: ImportCounts) = "Main ${counts.main} · Extra ${counts.extra} · Side ${counts.side}"
    fun skippedText(n: Int): String? = if (n > 0) "$n nicht übernommen" else null
    fun deckNameFor(fileName: String?): String = fileName?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_DECK_NAME

    private fun displayName(c: CatalogNameRow) = c.nameDe?.takeIf { it.isNotEmpty() } ?: c.nameEn?.takeIf { it.isNotEmpty() } ?: c.id
    private fun candidate(c: CatalogNameRow) = ImportCandidate(c.id, displayName(c), c.type ?: "")
    // Codeeinheiten-Vergleich wie "<" im JS-Zwilling (kein Locale-Vergleich).
    private val byNameThenPasscode = compareBy<ImportCandidate>({ it.name }, { it.passcode })

    private class Index(cards: List<CatalogNameRow>) {
        val byId = LinkedHashMap<String, CatalogNameRow>()
        val exact = HashMap<String, MutableList<String>>()
        val norm = HashMap<String, MutableList<String>>()
        val entries = ArrayList<Pair<String, List<String>>>()

        init {
            for (c in cards) {
                byId[c.id] = c
                val norms = mutableListOf<String>()
                for (name in listOfNotNull(c.nameDe, c.nameEn).filter { it.isNotEmpty() }) {
                    add(exact, name.trim().lowercase(), c.id)
                    val n = normalizeName(name)
                    add(norm, n, c.id)
                    if (n.isNotEmpty() && n !in norms) norms.add(n)
                }
                entries.add(c.id to norms)
            }
        }

        private fun add(map: HashMap<String, MutableList<String>>, key: String, id: String) {
            if (key.isEmpty()) return
            val list = map.getOrPut(key) { mutableListOf() }
            if (id !in list) list.add(id)
        }
    }

    private fun fuzzy(index: Index, n: String): List<ImportCandidate> {
        if (n.length < 6) return emptyList()
        val hits = ArrayList<Pair<ImportCandidate, Int>>()
        for ((id, norms) in index.entries) {
            var best = Int.MAX_VALUE
            for (x in norms) {
                if (Math.abs(x.length - n.length) > 2) continue   // folgt aus Abstand <= 2; spart die Rechnung
                best = minOf(best, levenshtein(n, x))
            }
            if (best <= 2) hits.add(candidate(index.byId.getValue(id)) to best)
        }
        return hits.sortedWith(compareBy<Pair<ImportCandidate, Int>> { it.second }.thenBy(byNameThenPasscode) { it.first })
            .take(3).map { it.first }
    }

    /** [catalog] null = kein Katalog. Fuer YDK/YDKE reichen die Zeilen der gelesenen Passcodes, fuer Text alle. */
    fun resolve(parsed: ParsedDeck, catalog: List<CatalogNameRow>?): ResolvedImport {
        val index = Index(catalog ?: emptyList())
        val rows = parsed.cards.map { card ->
            if (card.passcode != null) {
                val c = index.byId[card.passcode]
                if (c != null) ImportRow("ok", card.count, card.section, card.passcode, listOf(candidate(c)))
                else ImportRow("unknownPasscode", card.count, card.section, card.passcode, emptyList())
            } else {
                val source = card.line ?: card.name ?: ""
                val name = card.name ?: ""
                val n = normalizeName(name)
                val ids = index.exact[name.trim().lowercase()] ?: (if (n.isNotEmpty()) index.norm[n] else null)
                if (ids != null) {
                    val cands = ids.map { candidate(index.byId.getValue(it)) }.sortedWith(byNameThenPasscode)
                    ImportRow(if (ids.size == 1) "ok" else "ambiguous", card.count, card.section, source, cands)
                } else {
                    val suggestions = fuzzy(index, n)
                    if (suggestions.isNotEmpty()) ImportRow("suggest", card.count, card.section, source, suggestions)
                    else ImportRow("notFound", card.count, card.section, source, emptyList())
                }
            }
        }
        return ResolvedImport(catalog == null, rows, parsed.unresolved)
    }

    /** [choices]: Zeilenindex -> Passcode (Auswahl bei Vorschlag/Mehrdeutig). Offene Zeilen werden nicht uebernommen. */
    fun plan(resolved: ResolvedImport, choices: Map<Int, String> = emptyMap()): ImportPlan {
        val cards = mutableListOf<ImportCard>()
        var main = 0; var extra = 0; var side = 0
        val skipped = resolved.unresolved.toMutableList()
        val skippedLabels = resolved.unresolved.toMutableList()
        resolved.rows.forEachIndexed { i, row ->
            val chosen = when (row.status) {
                "ok" -> row.candidates.first()
                "ambiguous", "suggest" -> row.candidates.firstOrNull { it.passcode == choices[i] }
                else -> null
            }
            if (chosen == null) {
                skipped.add(if (row.status == "unknownPasscode") unknownPasscodeText(row.source) else row.source)
                skippedLabels.add(
                    if (row.status == "unknownPasscode") unknownPasscodeText(row.source)
                    else "${row.source} · ${if (row.status == "notFound") NOT_FOUND else OPEN}"
                )
                return@forEachIndexed
            }
            val section = if (row.section == "unknown") deckSectionFor(chosen.type) else row.section
            val at = cards.indexOfFirst { it.cardId == chosen.passcode && it.section == section }
            if (at >= 0) cards[at] = cards[at].copy(count = cards[at].count + row.count)
            else cards.add(ImportCard(chosen.passcode, chosen.name, row.count, section))
            when (section) { "extra" -> extra += row.count; "side" -> side += row.count; else -> main += row.count }
        }
        val notes = if (skipped.isEmpty()) null else (listOf(NOTES_HEAD) + skipped).joinToString("\n")
        return ImportPlan(cards, ImportCounts(main, extra, side), skipped, skippedLabels, notes)
    }

    /**
     * Einstieg der Vorschau (Einfuegen, Teilen): lesen mit dem gemeinsamen Parser, dann den Katalog laden -- fuer
     * YDK/YDKE nur die gelesenen Passcodes, fuer die Textliste alle Karten -- und aufloesen. [loadCatalog] liefert
     * null ohne Katalog. Laeuft abseits des Hauptthreads (Katalogzugriff, Fuzzy-Suche).
     */
    fun prepare(text: String, format: String?, loadCatalog: (List<String>?) -> List<CatalogNameRow>?): PreparedImport {
        val parsed = if (format != null) DeckFormats.parseDeckText(text, format) else DeckFormats.parseDeckText(text)
        if (parsed.error != null) return PreparedImport(parsed.error, null)
        val ids = if (parsed.format == "text") null else parsed.cards.mapNotNull { it.passcode }
        return PreparedImport(null, resolve(parsed, loadCatalog(ids)))
    }
}
