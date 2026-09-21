package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.DuplicateEntry
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.DuplicatesSummary
import com.example.yugiohscanner.ml.ForSaleGroup
import com.example.yugiohscanner.ml.ForSaleSummary
import com.example.yugiohscanner.ml.SaleCopy
import com.example.yugiohscanner.ml.ToggleTargets
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/duplicates.test.js -- dieselbe Fixture docs/fixtures/duplicates/duplicates.json. */
class DuplicatesTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/duplicates/duplicates.json"))
    private val base = fix.getJSONObject("base")
    private val aliases: Map<String, String> = fix.getJSONObject("aliases").let { o -> o.keys().asSequence().associateWith { o.getString(it) } }

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun dbl(o: JSONObject, k: String): Double? = if (!o.has(k) || o.isNull(k)) null else o.getDouble(k)
    private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

    /** Exemplar = base plus die Felder des Eintrags; das Printing traegt Name und Preise. */
    private fun saleCopy(partial: JSONObject): SaleCopy {
        val o = JSONObject(base.toString())
        for (k in partial.keys()) o.put(k, partial.get(k))
        val copy = CopyRow(
            copyId = o.getString("copy_id"), cardId = o.getString("card_id"), setCode = o.getString("set_code"),
            language = o.getString("language"), rarity = o.getString("rarity"), edition = o.getString("edition"),
            condition = o.getString("condition"), deleted = o.getBoolean("deleted"),
            containerId = str(o, "container_id"), page = null, slot = null, tags = str(o, "tags"), note = str(o, "note"),
            createdAt = str(o, "created_at"), forSale = o.getBoolean("for_sale"),
        )
        val card = CardRow(
            id = copy.cardId, setCode = copy.setCode, language = copy.language, name = str(o, "name"), imageUrl = null,
            rarity = copy.rarity, quantity = 1, price = dbl(o, "price"), priceFirstEd = dbl(o, "price_first_ed"),
        )
        return SaleCopy(copy, card)
    }

    private fun entry(o: JSONObject) =
        DuplicateEntry(o.getString("main_id"), o.getInt("count"), o.getInt("surplus"), strings(o.getJSONArray("copy_ids")), o.getDouble("value"))

    @Test fun `Fixture Duplikate und Texte`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val copies = c.getJSONArray("copies").objects().map { saleCopy(it) }
            val list = Duplicates.duplicates(copies, str(c, "keep"), if (c.getBoolean("catalog")) { p -> aliases[p] ?: p } else null)
            assertEquals(name, c.getJSONArray("expected").objects().map { entry(it) }, list)
            if (c.has("texts")) {
                val t = c.getJSONObject("texts")
                val summary = Duplicates.summary(list)
                val byId = copies.associateBy { it.copy.copyId }
                assertEquals(name, t.getString("header"), Duplicates.headerText(summary))
                assertEquals(name, t.getString("confirm"), Duplicates.confirmAllText(summary))
                assertEquals(name, t.getString("startDuplicates"), Duplicates.startDuplicatesText(summary))
                assertEquals(name, strings(t.getJSONArray("rows")), list.map { Duplicates.rowCountText(it) })
                val proposals = t.getJSONArray("proposals")
                assertEquals(name, (0 until proposals.length()).map { strings(proposals.getJSONArray(it)) }, list.map { Duplicates.proposalTexts(it, byId) })
            }
            if (c.has("allProposalIds")) {
                val a = c.getJSONObject("allProposalIds")
                assertEquals(name, strings(a.getJSONArray("ids")), Duplicates.allProposalIds(list, strings(a.getJSONArray("forSale")).toSet()))
            }
        }
    }

    @Test fun `Fixture keep_per_card`() {
        for (k in fix.getJSONArray("keep").objects()) assertEquals(k.toString(), k.getInt("expected"), Duplicates.keepPerCard(str(k, "raw")))
        assertEquals(3, Duplicates.KEEP_DEFAULT)
    }

    @Test fun `Fixture Euro-Texte`() {
        for (e in fix.getJSONArray("euro").objects()) {
            assertEquals(e.toString(), e.getString("cents"), Duplicates.euroCents(e.getDouble("value")))
            assertEquals(e.toString(), e.getString("whole"), Duplicates.euroWhole(e.getDouble("value")))
        }
    }

    @Test fun `Fixture Verkaufsliste, Summen und Texte`() {
        val f = fix.getJSONObject("forSale")
        val copies = f.getJSONArray("copies").objects().map { saleCopy(it) }
        val s = Duplicates.forSaleSummary(copies)
        val e = f.getJSONObject("expected")
        assertEquals(ForSaleSummary(e.getInt("copies"), e.getDouble("value")), s)
        assertEquals(
            f.getJSONArray("groups").objects().map {
                ForSaleGroup(it.getString("card_id"), it.getString("set_code"), it.getString("language"), it.getString("rarity"), str(it, "name"), strings(it.getJSONArray("copy_ids")))
            },
            Duplicates.forSaleGroups(copies),
        )
        val t = f.getJSONObject("texts")
        assertEquals(t.getString("header"), Duplicates.forSaleHeaderText(s))
        assertEquals(t.getString("start"), Duplicates.startSaleText(s))
        assertEquals(t.getString("share"), Duplicates.saleShareText(s))
        val values = f.getJSONObject("copyValues")
        for (id in values.keys()) assertEquals(id, values.getString(id), Duplicates.copyValueText(copies.first { it.copy.copyId == id }))
        for (x in fix.getJSONArray("summaryTexts").objects()) {
            val o = x.getJSONObject("summary")
            val sum = ForSaleSummary(o.getInt("copies"), o.getDouble("value"))
            assertEquals(x.getString("header"), Duplicates.forSaleHeaderText(sum))
            assertEquals(x.getString("start"), Duplicates.startSaleText(sum))
            assertEquals(x.getString("share"), Duplicates.saleShareText(sum))
        }
        for (x in fix.getJSONArray("suffix").objects()) assertEquals(str(x, "text"), Duplicates.forSaleSuffix(x.getInt("n")))
    }

    @Test fun `Fixture Zeilen-Schalter`() {
        val t = fix.getJSONObject("toggle")
        val e = entry(t.getJSONObject("entry"))
        for (c in t.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val marked = strings(c.getJSONArray("forSale")).toSet()
            val pre = Duplicates.premarkedIds(e, marked)
            assertEquals(name, c.getBoolean("isOn"), Duplicates.toggleIsOn(e, marked))
            assertEquals(name, strings(c.getJSONArray("premarked")), pre)
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("on")), true), Duplicates.toggleTargets(e, true, pre))
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("offWithHistory")), false), Duplicates.toggleTargets(e, false, pre))
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("offWithoutHistory")), false), Duplicates.toggleTargets(e, false, null))
        }
    }

    @Test fun `Platzhalter ist nie eine Null und leere Liste hat Summe null`() {
        assertEquals("…", Duplicates.LOADING)
        assertEquals(DuplicatesSummary(0, 0, 0.0), Duplicates.summary(emptyList()))
    }

    /** Spec H1 I1: "…" nur bis zum ersten Ergebnis; danach bleibt der alte Stand stehen, auch wenn
     *  cards/copies/keep sich schon geaendert haben -- die Identitaetspruefung darf das nicht mehr
     *  erzwingen. Nur ohne Speicher (storeReady = false) wird der Platzhalter erzwungen. */
    @Test fun `Sichtbarer Stand bleibt bei Aenderung stehen, nur ohne Speicher weg`() {
        assertEquals(null, Duplicates.visibleSaleData(false, "alt"))
        assertEquals(null, Duplicates.visibleSaleData(false, null))
        assertEquals("alt", Duplicates.visibleSaleData(true, "alt"))
        assertEquals(null, Duplicates.visibleSaleData(true, null))
    }
}
