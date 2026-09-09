package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Tags
import org.junit.Assert.assertEquals
import org.junit.Test

class TagsTest {

    @Test fun `parse vertraegt null leer und Unsinn`() {
        for (bad in listOf(null, "", "   ", "kein json", """{"a":1}""", "42", "\"text\"")) {
            assertEquals("fiel um bei: $bad", emptyList<String>(), Tags.parse(bad))
        }
    }

    @Test fun `parse liest ein Array und wirft Nicht-Zeichenketten weg`() {
        assertEquals(listOf("Kratzer", "Tausch Max"), Tags.parse("""["Kratzer", 7, null, "Tausch Max"]"""))
    }

    @Test fun `parse beschneidet und entfernt Leere`() {
        assertEquals(listOf("Kratzer", "Tausch"), Tags.parse("""["  Kratzer  ", "   ", "Tausch"]"""))
    }

    @Test fun `parse entfernt Doppelte ohne Ruecksicht auf Gross-Kleinschreibung`() {
        assertEquals(listOf("Tausch"), Tags.parse("""["Tausch", "tausch", "TAUSCH"]"""))
    }

    @Test fun `parse behaelt die Einfuegereihenfolge`() {
        assertEquals(listOf("Zebra", "Anton"), Tags.parse("""["Zebra", "Anton"]"""))
    }

    @Test fun `serialize gibt bei leerer Liste null`() {
        assertEquals(null, Tags.serialize(emptyList()))
    }

    @Test fun `serialize und parse sind zueinander invers`() {
        val list = listOf("Kratzer", "Tausch Max")
        assertEquals(list, Tags.parse(Tags.serialize(list)))
    }

    @Test fun `add haengt an beschneidet und ignoriert Doppelte`() {
        assertEquals(listOf("Kratzer", "Tausch"), Tags.add(listOf("Kratzer"), "  Tausch "))
        assertEquals(listOf("Tausch"), Tags.add(listOf("Tausch"), "tausch"))
        assertEquals(listOf("Tausch"), Tags.add(listOf("Tausch"), "   "))
    }

    @Test fun `remove entfernt ohne Ruecksicht auf Gross-Kleinschreibung`() {
        assertEquals(listOf("Kratzer"), Tags.remove(listOf("Kratzer", "Tausch"), "TAUSCH"))
        assertEquals(listOf("Kratzer"), Tags.remove(listOf("Kratzer"), "gibtsnicht"))
    }
}
