package com.example.yugiohscanner

import com.example.yugiohscanner.ui.NavTabellen
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/nav.test.js -- dieselbe Tabelle docs/fixtures/design/nav.json. */
class NavTabellenTest {
    private val n = JSONObject(Fixtures.text("docs/fixtures/design/nav.json"))

    private fun paare(schluessel: String): List<Pair<String, String>> {
        val a = n.getJSONObject("segments").getJSONArray(schluessel)
        return (0 until a.length()).map { a.getJSONArray(it).getString(0) to a.getJSONArray(it).getString(1) }
    }

    @Test fun untereLeisteZeigtVierZiele() {
        val a = n.getJSONArray("handyLeiste")
        assertEquals((0 until a.length()).map { a.getString(it) }, NavTabellen.LEISTE.map { it.first })
        assertEquals(4, NavTabellen.LEISTE.size)
    }

    @Test fun beschriftungenStimmen() {
        val labels = n.getJSONObject("labels")
        for ((key, label) in NavTabellen.LEISTE) assertEquals(key, labels.getString(key), label)
    }

    @Test fun unterteilungenStimmen() {
        assertEquals(paare("sammlung"), NavTabellen.SAMMLUNG)
        assertEquals(paare("verkaufen"), NavTabellen.VERKAUFEN)
    }
}
