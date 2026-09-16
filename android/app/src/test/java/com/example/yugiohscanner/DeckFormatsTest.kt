package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckEntry
import com.example.yugiohscanner.ml.DeckFormats
import com.example.yugiohscanner.ml.ParsedCard
import com.example.yugiohscanner.ml.ParsedDeck
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckFormats.test.js -- dieselbe Fixture docs/fixtures/decks/formats.json. */
class DeckFormatsTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/formats.json"))

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    private fun cards(arr: JSONArray): List<ParsedCard> = arr.objects().map {
        ParsedCard(str(it, "passcode"), str(it, "name"), it.getInt("count"), it.getString("section"), str(it, "line"))
    }

    private fun strings(arr: JSONArray): List<String> = (0 until arr.length()).map { arr.getString(it) }

    @Test fun `Fixture lesen`() {
        for (c in fix.getJSONArray("parse").objects()) {
            val text = c.getString("text")
            val got = str(c, "format")?.let { DeckFormats.parseDeckText(text, it) } ?: DeckFormats.parseDeckText(text)
            val e = c.getJSONObject("expected")
            val expected = ParsedDeck(e.getString("format"), cards(e.getJSONArray("cards")), strings(e.getJSONArray("unresolved")), str(e, "error"))
            assertEquals(c.getString("name"), expected, got)
        }
    }

    @Test fun `Fixture Erkennung`() {
        for (d in fix.getJSONArray("detect").objects()) {
            assertEquals(d.getString("text"), d.getString("format"), DeckFormats.detectFormat(d.getString("text")))
        }
    }

    private fun sectionSums(cards: List<ParsedCard>) = listOf("main", "extra", "side").map { s -> cards.filter { it.section == s }.sumOf { it.count } }

    @Test fun `Fixture schreiben und zuruecklesen`() {
        for (b in fix.getJSONArray("build").objects()) {
            val name = b.getString("name")
            val entries = b.getJSONArray("entries").objects().map {
                DeckEntry(it.getString("passcode"), str(it, "name"), it.getInt("count"), it.getString("section"))
            }
            assertEquals("$name ydk", b.getString("ydk"), DeckFormats.buildYdk(entries))
            assertEquals("$name ydke", b.getString("ydke"), DeckFormats.buildYdke(entries))
            assertEquals("$name text", b.getString("text"), DeckFormats.buildTextList(entries))
            val roundtrip = cards(b.getJSONArray("roundtrip"))
            if (roundtrip.isNotEmpty()) {
                assertEquals("$name ydk zurueck", roundtrip, DeckFormats.parseDeckText(b.getString("ydk")).cards)
                assertEquals("$name ydke zurueck", roundtrip, DeckFormats.parseDeckText(b.getString("ydke")).cards)
                assertEquals("$name text zurueck", sectionSums(roundtrip), sectionSums(DeckFormats.parseTextList(b.getString("text")).cards))
            }
        }
    }

    @Test fun `Passcodes fuehrende Nullen weg, 0 und zu gross ungueltig`() {
        assertEquals("4031928", DeckFormats.normalizePasscode("04031928"))
        assertEquals("4294967295", DeckFormats.normalizePasscode("4294967295"))
        assertEquals(null, DeckFormats.normalizePasscode("4294967296"))
        assertEquals(null, DeckFormats.normalizePasscode("0000"))
        assertEquals(null, DeckFormats.normalizePasscode("12a"))
    }
}
