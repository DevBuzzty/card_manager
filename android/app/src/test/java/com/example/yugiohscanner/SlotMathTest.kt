package com.example.yugiohscanner

import com.example.yugiohscanner.ml.SlotMath
import org.junit.Assert.assertEquals
import org.junit.Test

class SlotMathTest {

    @Test fun `next rueckt innerhalb der Seite vor`() {
        assertEquals(3 to 5, SlotMath.next(3, 4, 9))
    }

    @Test fun `next blaettert am Seitenende um`() {
        assertEquals(4 to 1, SlotMath.next(3, 9, 9))
        assertEquals(4 to 1, SlotMath.next(3, 4, 4))
        assertEquals(4 to 1, SlotMath.next(3, 12, 12))
    }

    @Test fun `firstFree bei leerem Binder ist Seite 1 Fach 1`() {
        assertEquals(1 to 1, SlotMath.firstFree(emptySet(), 9))
    }

    @Test fun `firstFree findet die Luecke, nicht das Ende`() {
        // Fach 2 auf Seite 1 ist frei -- der Vorschlag muss dorthin, nicht hinter das letzte.
        val belegt = setOf(1 to 1, 1 to 3, 1 to 4)
        assertEquals(1 to 2, SlotMath.firstFree(belegt, 9))
    }

    @Test fun `firstFree geht bei voller Seite auf die naechste`() {
        val volleSeite = (1..4).map { 1 to it }.toSet()
        assertEquals(2 to 1, SlotMath.firstFree(volleSeite, 4))
    }

    @Test fun `firstFree ueberspringt eine ganz volle Seite und findet die Luecke dahinter`() {
        val belegt = (1..4).map { 1 to it }.toSet() + setOf(2 to 1, 2 to 3)
        assertEquals(2 to 2, SlotMath.firstFree(belegt, 4))
    }

    @Test fun `firstFree ignoriert Faecher jenseits der Seitengroesse`() {
        // Ein Datensatz aus einer frueheren, groesseren Seitengroesse darf nicht dazu fuehren,
        // dass ein gueltiges Fach als belegt gilt.
        val belegt = setOf(1 to 1, 1 to 7)
        assertEquals(1 to 2, SlotMath.firstFree(belegt, 4))
    }

    @Test fun `unsinnige Eingaben werfen nicht`() {
        SlotMath.next(0, 0, 0)
        SlotMath.next(-3, -1, 9)
        SlotMath.firstFree(setOf(0 to 0), 0)
    }

    @Test fun `maxOccupiedPage ist null ohne belegte Seite`() {
        assertEquals(null, SlotMath.maxOccupiedPage(emptyList()))
        assertEquals(null, SlotMath.maxOccupiedPage(listOf(null, null)))
    }

    @Test fun `maxOccupiedPage findet die hoechste belegte Seite`() {
        assertEquals(3, SlotMath.maxOccupiedPage(listOf(1, null, 3, 2)))
    }
}
