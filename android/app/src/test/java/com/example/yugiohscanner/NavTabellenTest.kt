package com.example.yugiohscanner

import com.example.yugiohscanner.ui.NavTabellen
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    // Abschlussreview C5: Decks, Insights und Einstellungen liegen am Handy ueber Start. Geprueft wird die
    // Tabelle gegen nav.json und, dass StartScreen je Bereich einen Einstieg hat, den AppNav auch verdrahtet.
    @Test fun bereicheUeberStartHabenEinenEinstieg() {
        val a = n.getJSONArray("handyUeberStart")
        assertEquals((0 until a.length()).map { a.getString(it) }, NavTabellen.UEBER_START)
        val start = Fixtures.text("android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt")
        val nav = Fixtures.text("android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt")
        for (key in NavTabellen.UEBER_START) {
            val rueckruf = "onOpen" + key.replaceFirstChar { it.uppercase() }
            val vorkommen = Regex("\\b$rueckruf\\b").findAll(start).count()
            assertTrue("$rueckruf: StartScreen nutzt den Einstieg nicht (nur $vorkommen Vorkommen)", vorkommen >= 2)
            assertTrue("$rueckruf: AppNav verdrahtet den Einstieg nicht", nav.contains("$rueckruf = {"))
        }
    }

    @Test fun unterteilungenStimmen() {
        assertEquals(paare("sammlung"), NavTabellen.SAMMLUNG)
        assertEquals(paare("verkaufen"), NavTabellen.VERKAUFEN)
    }
}
