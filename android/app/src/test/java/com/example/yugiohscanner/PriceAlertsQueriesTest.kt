package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceAlertEvent
import com.example.yugiohscanner.cloud.PriceAlertMoveRule
import com.example.yugiohscanner.cloud.PriceAlertTarget
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PriceAlertsQueriesTest {
    private val card = CardRow("1", "LOB-DE001", "DE", "A", null, null, 1, 2.0)

    @Test fun `offene Treffer, neueste zuerst, hoechstens 200`() {
        assertEquals(
            listOf("select" to "*", "dismissed" to "eq.false", "order" to "id.desc", "limit" to "200"),
            PriceAlertsRepository.eventsParams(),
        )
    }

    @Test fun `Alle erledigt nur bis zur groessten angezeigten id`() {
        assertEquals(
            listOf("dismissed" to "eq.false", "id" to "lte.42"),
            PriceAlertsRepository.dismissAllParams(42),
        )
    }

    @Test fun `Bewegungsregel und aktive Zielpreise`() {
        assertEquals(
            listOf("select" to "id,pct,min_eur,days,active", "kind" to "eq.move", "limit" to "1"),
            PriceAlertsRepository.moveRuleParams(),
        )
        assertEquals(
            listOf(
                "select" to "kind,card_id,set_code,language,rarity,threshold,armed",
                "kind" to "in.(above,below)", "active" to "eq.true",
            ),
            PriceAlertsRepository.targetsParams(),
        )
    }

    @Test fun `Zielpreis-Schluessel, fehlende Raritaet als Unknown`() {
        assertEquals(
            listOf("kind" to "eq.below", "card_id" to "eq.1", "set_code" to "eq.LOB-DE001", "language" to "eq.DE", "rarity" to "eq.Unknown"),
            PriceAlertsRepository.targetKeyParams(card, "below"),
        )
        assertEquals("user_id,kind,card_id,set_code,language,rarity", PriceAlertsRepository.TARGET_CONFLICT)
        val body = PriceAlertsRepository.targetBody(card, "above", 12.5)
        assertEquals("above", body.getString("kind"))
        assertEquals("Unknown", body.getString("rarity"))
        assertEquals(12.5, body.getDouble("threshold"), 1e-9)
        assertEquals(true, body.getBoolean("active"))
        assertEquals(true, body.getBoolean("armed"))
        assertEquals(false, body.has("user_id"))
    }

    @Test fun `parse Treffer mit Nullwerten`() {
        val e = PriceAlertsRepository.parseEvents(
            """[{"id":7,"kind":"below","card_id":"1","set_code":"Unknown","language":"DE","rarity":"Common","old_price":null,"new_price":4,"pct":null,"days":null,"threshold":5,"day":"2026-09-14","dismissed":false}]""",
        )
        assertEquals(listOf(PriceAlertEvent(7, "below", "1", "Unknown", "DE", "Common", null, 4.0, null, null, 5.0, "2026-09-14")), e)
    }

    @Test fun `parse Bewegungsregel und Zielpreise`() {
        assertNull(PriceAlertsRepository.parseMoveRule("[]"))
        assertEquals(
            PriceAlertMoveRule(3, 20.0, 2.0, 7, true),
            PriceAlertsRepository.parseMoveRule("""[{"id":3,"pct":20,"min_eur":2,"days":7,"active":true}]"""),
        )
        val t = PriceAlertsRepository.parseTargets(
            """[{"kind":"above","card_id":"1","set_code":"LOB-DE001","language":"DE","rarity":"Unknown","threshold":50,"armed":false}]""",
        )
        assertEquals(listOf(PriceAlertTarget("above", "1", "LOB-DE001", "DE", "Unknown", 50.0, false)), t)
        assertEquals("1|LOB-DE001|DE|Unknown", t[0].key())
    }
}
