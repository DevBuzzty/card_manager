package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.CatalogNameRow
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.ImportCandidate
import com.example.yugiohscanner.ml.ImportCard
import com.example.yugiohscanner.ml.ImportCounts
import com.example.yugiohscanner.ml.ParsedCard
import com.example.yugiohscanner.ml.ParsedDeck
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckImport.test.js -- dieselbe Fixture docs/fixtures/decks/import.json. */
class DeckImportTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/import.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun strings(arr: JSONArray): List<String> = (0 until arr.length()).map { arr.getString(it) }

    private val catalog = fix.getJSONArray("catalog").objects().map {
        CatalogNameRow(it.get("id").toString(), str(it, "name_de"), str(it, "name_en"), str(it, "type"))
    }

    @Test fun `Fixture Normalisierung und Levenshtein`() {
        for (c in fix.getJSONArray("normalize").objects()) assertEquals(c.getString("in"), c.getString("out"), DeckImport.normalizeName(c.getString("in")))
        for (c in fix.getJSONArray("levenshtein").objects()) {
            assertEquals("${c.getString("a")}/${c.getString("b")}", c.getInt("d"), DeckImport.levenshtein(c.getString("a"), c.getString("b")))
        }
    }

    @Test fun `Fixture Abschnitt per Typ und Zeilenaktion`() {
        for (c in fix.getJSONArray("sectionFor").objects()) assertEquals("${str(c, "type")}", c.getString("section"), DeckImport.deckSectionFor(str(c, "type")))
        for (c in fix.getJSONArray("moveTarget").objects()) {
            assertEquals(c.getString("target"), DeckImport.moveTarget(c.getString("section"), str(c, "type")))
            assertEquals(c.getString("label"), DeckImport.moveLabel(c.getString("section")))
        }
    }

    @Test fun `Fixture aufloesen und Plan`() {
        for (c in fix.getJSONArray("resolve").objects()) {
            val name = c.getString("name")
            val p = c.getJSONObject("parsed")
            val parsed = ParsedDeck(
                p.getString("format"),
                p.getJSONArray("cards").objects().map { ParsedCard(str(it, "passcode"), str(it, "name"), it.getInt("count"), it.getString("section"), str(it, "line")) },
                strings(p.getJSONArray("unresolved")),
            )
            val resolved = DeckImport.resolve(parsed, if (c.getBoolean("catalog")) catalog else null)
            val e = c.getJSONObject("expected")
            assertEquals("$name catalogMissing", e.getBoolean("catalogMissing"), resolved.catalogMissing)
            val expectedRows = e.getJSONArray("rows").objects().map {
                listOf(it.getString("status"), it.getInt("count"), it.getString("section"), it.getString("source"), strings(it.getJSONArray("candidates")))
            }
            val gotRows = resolved.rows.map { listOf(it.status, it.count, it.section, it.source, it.candidates.map(ImportCandidate::passcode)) }
            assertEquals("$name rows", expectedRows, gotRows)

            for (plan in c.getJSONArray("plans").objects()) {
                val ch = plan.getJSONObject("choices")
                val choices = ch.keys().asSequence().associate { it.toInt() to ch.getString(it) }
                val got = DeckImport.plan(resolved, choices)
                val x = plan.getJSONObject("expected")
                val counts = x.getJSONObject("counts")
                assertEquals("$name $choices cards", x.getJSONArray("cards").objects().map {
                    ImportCard(it.getString("card_id"), it.getString("name"), it.getInt("count"), it.getString("section"))
                }, got.cards)
                assertEquals("$name counts", ImportCounts(counts.getInt("main"), counts.getInt("extra"), counts.getInt("side")), got.counts)
                assertEquals("$name skipped", strings(x.getJSONArray("skipped")), got.skipped)
                assertEquals("$name skippedLabels", strings(x.getJSONArray("skippedLabels")), got.skippedLabels)
                assertEquals("$name notes", str(x, "notes"), got.notes)
                assertEquals("$name countsText", x.getString("countsText"), DeckImport.countsText(got.counts))
                assertEquals("$name skippedText", str(x, "skippedText"), DeckImport.skippedText(got.skipped.size))
            }
        }
    }

    @Test fun `Fixture Texte`() {
        val t = fix.getJSONObject("texts")
        for (x in t.getJSONArray("failed").objects()) assertEquals(x.getString("text"), DeckImport.failedText(x.getString("message")))
        for (x in t.getJSONArray("deckName").objects()) assertEquals(x.getString("name"), DeckImport.deckNameFor(str(x, "file")))
        for (x in t.getJSONArray("suggestion").objects()) assertEquals(x.getString("text"), DeckImport.suggestionText(x.getString("name")))
        for (x in t.getJSONArray("ambiguousOption").objects()) {
            assertEquals(x.getString("text"), DeckImport.ambiguousOptionText(ImportCandidate(x.getString("passcode"), x.getString("name"), "")))
        }
        for (x in t.getJSONArray("unknownPasscode").objects()) assertEquals(x.getString("text"), DeckImport.unknownPasscodeText(x.getString("passcode")))
    }

    // F8: ohne e.message ("Anlegen" scheitert mit z. B. IllegalStateException()) faellt die Meldung auf den
    // Klassennamen zurueck statt woertlich "Import fehlgeschlagen: null" zu zeigen.
    @Test fun `failedTextFor faellt ohne Nachricht auf den Klassennamen zurueck`() {
        assertEquals("Import fehlgeschlagen: kaputt", DeckImport.failedTextFor(RuntimeException("kaputt")))
        assertEquals("Import fehlgeschlagen: IllegalStateException", DeckImport.failedTextFor(IllegalStateException()))
    }

    @Test fun `Vorschau vorbereiten laedt fuer YDKE nur die Passcodes, fuer Text alle, bei Lesefehler nichts`() {
        val calls = mutableListOf<List<String>?>()
        val load = { ids: List<String>? -> calls.add(ids); catalog }
        val ydke = DeckImport.prepare("ydke://ryPeAA==!!!", null, load)
        assertEquals(listOf(listOf("14558127")), calls)
        assertEquals("ok", ydke.resolved!!.rows[0].status)
        val text = DeckImport.prepare("3 Raigeki", null, load)
        assertEquals(null, calls[1])
        assertEquals(listOf("12580477"), text.resolved!!.rows[0].candidates.map { it.passcode })
        assertEquals("Kein gültiger YDKE-Link", DeckImport.prepare("ydke://kaputt", null, load).error)
        assertEquals("Keine Deckliste erkannt", DeckImport.prepare("3 Raigeki", "ydk", load).error)
        assertEquals("ohne gelesene Karte kein Katalogzugriff", 2, calls.size)
        assertEquals(true, DeckImport.prepare("3 Raigeki", null) { null }.resolved!!.catalogMissing)
    }
}
