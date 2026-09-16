package com.example.yugiohscanner.ml

/** Gelesene Karte: YDK/YDKE mit [passcode], Textliste mit [name] und Rohzeile [line]. section: main|extra|side|unknown. */
data class ParsedCard(
    val passcode: String?,
    val name: String?,
    val count: Int,
    val section: String,
    val line: String?,
)

data class ParsedDeck(val format: String, val cards: List<ParsedCard>, val unresolved: List<String>, val error: String? = null)

/** Eine Deckzeile zum Schreiben (mehrere Zeilen je Passcode erlaubt). */
data class DeckEntry(val passcode: String, val name: String?, val count: Int, val section: String)

/**
 * Spec E2 §3 -- Decklisten-Formate YDK, YDKE und Textliste: lesen, schreiben, erkennen.
 * ZWILLING: desktop/src/utils/deckFormats.js. Beide laufen gegen docs/fixtures/decks/formats.json.
 * Wer eine Seite aendert, aendert beide.
 */
object DeckFormats {
    const val YDKE_INVALID = "Kein gültiger YDKE-Link"
    const val NOTHING_RECOGNIZED = "Keine Deckliste erkannt"
    const val YDK_HEADER = "#created by YGO Card Manager"

    private const val MAX_UINT32 = 4294967295L
    // Standard-Base64 mit Auffuellung; dasselbe Muster wie der JS-Zwilling (java.util.Base64 ist nachsichtiger).
    private val BASE64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
    // (?U): \s wie im JS-Zwilling auch fuer geschuetzte Leerzeichen aus Webseiten; Ziffern bewusst [0-9].
    private val HEADING = Regex("(?U)^(main|extra|side)(?:\\s+deck)?\\s*(?::|\\([0-9]+\\))?$", RegexOption.IGNORE_CASE)
    private val COUNT_FIRST = Regex("(?U)^([0-9]+)(?:\\s*[xX])?\\s+(\\S.*)$")
    private val COUNT_LAST = Regex("(?U)^(.+?)\\s+[xX]([0-9]+)$")
    private val LINE_BREAK = Regex("\\r?\\n")
    private val WHITESPACE = Regex("(?U)\\s+")
    private val PASSCODE = Regex("^[0-9]{1,10}$")
    private val SECTIONS = listOf("main", "extra", "side")

    /** Passcode als Zahl ohne fuehrende Nullen; 1..2^32-1, sonst null. */
    fun normalizePasscode(raw: String): String? {
        val t = raw.trim()
        if (!PASSCODE.matches(t)) return null
        val n = t.toLong()
        return if (n in 1..MAX_UINT32) n.toString() else null
    }

    private fun MutableList<ParsedCard>.addPasscode(passcode: String, section: String) {
        val i = indexOfFirst { it.passcode == passcode && it.section == section }
        if (i >= 0) this[i] = this[i].copy(count = this[i].count + 1)
        else add(ParsedCard(passcode, null, 1, section, null))
    }

    fun parseYdk(text: String): ParsedDeck {
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        var section = "main"
        for (raw in text.split(LINE_BREAK)) {
            val t = raw.trim()
            if (t.isEmpty()) continue
            when (t.lowercase()) {
                "#main" -> section = "main"
                "#extra" -> section = "extra"
                "!side" -> section = "side"
                else -> if (!t.startsWith("#")) {
                    val passcode = normalizePasscode(t)
                    if (passcode != null) cards.addPasscode(passcode, section) else unresolved.add(t)
                }
            }
        }
        return ParsedDeck("ydk", cards, unresolved)
    }

    private fun decodeBlock(block: String): List<Long>? {
        if (!BASE64.matches(block)) return null
        val bytes = java.util.Base64.getDecoder().decode(block)
        if (bytes.size % 4 != 0) return null
        return (bytes.indices step 4).map { i ->
            (bytes[i].toLong() and 0xFF) or ((bytes[i + 1].toLong() and 0xFF) shl 8) or
                ((bytes[i + 2].toLong() and 0xFF) shl 16) or ((bytes[i + 3].toLong() and 0xFF) shl 24)
        }
    }

    fun parseYdke(text: String): ParsedDeck {
        val invalid = ParsedDeck("ydke", emptyList(), emptyList(), YDKE_INVALID)
        val body = text.trim()
        if (!body.startsWith("ydke://")) return invalid
        var parts = body.removePrefix("ydke://").replace(WHITESPACE, "").split("!")
        if (parts.size == 4 && parts[3].isEmpty()) parts = parts.take(3)
        if (parts.size != 3) return invalid
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        for (s in 0 until 3) {
            val codes = decodeBlock(parts[s]) ?: return invalid
            for (n in codes) {
                if (n == 0L) unresolved.add("0") else cards.addPasscode(n.toString(), SECTIONS[s])
            }
        }
        return ParsedDeck("ydke", cards, unresolved)
    }

    fun parseTextList(text: String): ParsedDeck {
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        var section = "unknown"
        for (raw in text.split(LINE_BREAK)) {
            val t = raw.trim()
            if (t.isEmpty() || t.startsWith("#") || t.startsWith("//")) continue
            val heading = HEADING.find(t)
            if (heading != null) { section = heading.groupValues[1].lowercase(); continue }
            var count = 1
            var name = t
            val first = COUNT_FIRST.find(t)
            val last = if (first == null) COUNT_LAST.find(t) else null
            if (first != null) { count = first.groupValues[1].toIntOrNull() ?: 0; name = first.groupValues[2] }
            else if (last != null) { name = last.groupValues[1]; count = last.groupValues[2].toIntOrNull() ?: 0 }
            if (count !in 1..99) { unresolved.add(t); continue }
            cards.add(ParsedCard(null, name.trim(), count, section, t))
        }
        return ParsedDeck("text", cards, unresolved)
    }

    fun detectFormat(text: String): String {
        val body = text.trim()
        if (body.startsWith("ydke://")) return "ydke"
        val lines = body.split(LINE_BREAK).map { it.trim().lowercase() }
        return if ("#main" in lines || "!side" in lines) "ydk" else "text"
    }

    /** Einstieg fuer Einfuegen/Teilen: erkennt (oder nimmt [format]), liest, "Keine Deckliste erkannt" ohne Karte. */
    fun parseDeckText(text: String, format: String = detectFormat(text)): ParsedDeck {
        val parsed = when (format) {
            "ydke" -> parseYdke(text)
            "ydk" -> parseYdk(text)
            else -> parseTextList(text)
        }
        if (parsed.error != null) return parsed
        return if (parsed.cards.isEmpty()) parsed.copy(error = NOTHING_RECOGNIZED) else parsed
    }

    private fun ofSection(entries: List<DeckEntry>, section: String) = entries.filter { it.count > 0 && it.section == section }

    fun buildYdk(entries: List<DeckEntry>): String {
        val lines = mutableListOf(YDK_HEADER)
        for ((head, section) in listOf("#main" to "main", "#extra" to "extra", "!side" to "side")) {
            lines.add(head)
            for (e in ofSection(entries, section)) repeat(e.count) { lines.add(e.passcode) }
        }
        return lines.joinToString("\n") + "\n"
    }

    private fun encodeBlock(entries: List<DeckEntry>): String {
        val out = java.io.ByteArrayOutputStream()
        for (e in entries) {
            val n = e.passcode.toLong()
            repeat(e.count) {
                out.write((n and 0xFF).toInt()); out.write(((n shr 8) and 0xFF).toInt())
                out.write(((n shr 16) and 0xFF).toInt()); out.write(((n shr 24) and 0xFF).toInt())
            }
        }
        return java.util.Base64.getEncoder().encodeToString(out.toByteArray())
    }

    fun buildYdke(entries: List<DeckEntry>): String =
        "ydke://" + SECTIONS.joinToString("") { encodeBlock(ofSection(entries, it)) + "!" }

    fun buildTextList(entries: List<DeckEntry>): String {
        val lines = mutableListOf<String>()
        for ((head, section) in listOf("Main Deck" to "main", "Extra Deck" to "extra", "Side Deck" to "side")) {
            val summed = LinkedHashMap<String, Pair<String, Int>>()
            for (e in ofSection(entries, section)) {
                val prev = summed[e.passcode]
                summed[e.passcode] = if (prev == null) (e.name?.takeIf { it.isNotEmpty() } ?: e.passcode) to e.count
                else prev.first to prev.second + e.count
            }
            if (summed.isEmpty()) continue
            lines.add(head)
            for ((name, count) in summed.values) lines.add("$count $name")
        }
        return lines.joinToString("\n")
    }
}
