package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.LegalityCard
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityInfo
import com.example.yugiohscanner.ml.LegalityIssue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckLegality.test.js -- dieselbe Fixture docs/fixtures/decks/legality.json. */
class DeckLegalityTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/legality.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    private val catalog: LegalityCatalog = fix.getJSONObject("catalog").let { c ->
        val a = c.getJSONObject("aliases")
        val cards = c.getJSONObject("cards")
        LegalityCatalog(
            aliases = a.keys().asSequence().associateWith { a.getString(it) },
            cards = cards.keys().asSequence().associateWith { id ->
                val o = cards.getJSONObject(id)
                LegalityInfo(str(o, "name"), str(o, "type"), str(o, "ban_tcg"), str(o, "ban_ocg"))
            },
        )
    }

    private fun rows(arr: JSONArray): List<LegalityCard> =
        arr.objects().map { LegalityCard(it.getString("card_id"), str(it, "name"), it.getInt("count"), it.getString("section")) }

    private fun issues(arr: JSONArray, withRule: Boolean): List<LegalityIssue> = arr.objects().map {
        LegalityIssue(if (withRule) it.getInt("rule") else null, str(it, "cardId"), it.getString("text"))
    }

    @Test fun `Fixture Legalitaet und Badge`() {
        val bases = fix.getJSONObject("bases")
        for (c in fix.getJSONArray("legality").objects()) {
            val name = c.getString("name")
            val base = c.getJSONArray("base")
            val cards = (0 until base.length()).flatMap { rows(bases.getJSONArray(base.getString(it))) } + rows(c.getJSONArray("cards"))
            val format = str(c, "format")
            val result = DeckLegality.check(cards, format, if (c.getBoolean("catalog")) catalog else null)
            val e = c.getJSONObject("expected")
            assertEquals("$name violations", issues(e.getJSONArray("violations"), true), result.violations)
            assertEquals("$name warnings", issues(e.getJSONArray("warnings"), false), result.warnings)
            assertEquals("$name legal", e.getBoolean("legal"), result.legal)
            assertEquals("$name badge", e.getString("badge"), DeckLegality.badgeText(result, format))
            assertEquals("$name badgeKind", e.getString("badgeKind"), DeckLegality.badgeKind(result, format))
        }
    }

    @Test fun `Fixture Formate, Banlist-Stufe, Banlist-Stand, Anzahl Verstoesse`() {
        for (f in fix.getJSONArray("formats").objects()) {
            val n = DeckLegality.normalizeFormat(str(f, "format"))
            assertEquals(f.toString(), f.getString("normalized"), n)
            assertEquals(f.getString("label"), DeckLegality.FORMAT_LABELS[n])
        }
        for (b in fix.getJSONArray("ban").objects()) {
            val ban = DeckLegality.banOf(b.getString("passcode"), b.getString("format"), if (b.getBoolean("catalog")) catalog else null)
            assertEquals(b.toString(), str(b, "expected"), ban)
            assertEquals(b.toString(), str(b, "label"), ban?.let { DeckLegality.BAN_LABELS[it] })
        }
        for (d in fix.getJSONArray("banlistDate").objects()) assertEquals(d.toString(), str(d, "text"), DeckLegality.banlistDateText(str(d, "builtAt")))
        for (v in fix.getJSONArray("violationCount").objects()) assertEquals(v.getString("text"), DeckLegality.violationCountText(v.getInt("n")))
    }

    @Test fun `Fixture Kopien-Grenze`() {
        for (c in fix.getJSONArray("canAddCopy").objects()) {
            assertEquals(
                c.getString("name"), c.getBoolean("expected"),
                DeckLegality.canAddCopy(rows(c.getJSONArray("cards")), c.getString("passcode"), str(c, "format"), if (c.getBoolean("aliases")) catalog.aliases else null),
            )
        }
    }
}
