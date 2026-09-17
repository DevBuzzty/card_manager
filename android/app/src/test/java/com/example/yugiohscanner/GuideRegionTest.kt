package com.example.yugiohscanner

import com.example.yugiohscanner.ml.GuideRegion
import com.example.yugiohscanner.ml.GuideRegion.NRect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GuideRegionTest {

    private fun assertRect(expected: NRect, actual: NRect) {
        assertEquals(expected.l, actual.l, 1e-4f)
        assertEquals(expected.t, actual.t, 1e-4f)
        assertEquals(expected.r, actual.r, 1e-4f)
        assertEquals(expected.b, actual.b, 1e-4f)
    }

    @Test
    fun viewToUpright_fillCenter_beschneidetSeitlich() {
        // View 1080x2400, Bild aufrecht 1080x1920: Skalierung 1,25, links/rechts je 135 px abgeschnitten.
        val r = GuideRegion.viewToUpright(135f, 1200f, 1215f, 2400f, 1080f, 2400f, 1080, 1920)
        assertRect(NRect(0.2f, 0.5f, 1f, 1f), r)
    }

    @Test
    fun viewToUpright_klemmtAufBild() {
        val r = GuideRegion.viewToUpright(-500f, -10f, 5000f, 9000f, 1080f, 2400f, 1080, 1920)
        assertRect(NRect(0f, 0f, 1f, 1f), r)
    }

    @Test
    fun uprightToSensor_rotation0_unveraendert() {
        val r = NRect(0.1f, 0.2f, 0.3f, 0.4f)
        assertRect(r, GuideRegion.uprightToSensor(r, 0))
    }

    @Test
    fun uprightToSensor_rotation90() {
        // Sensor oben links landet nach 90 Grad im Uhrzeigersinn aufrecht oben rechts.
        assertRect(NRect(0f, 0f, 0.2f, 0.1f), GuideRegion.uprightToSensor(NRect(0.9f, 0f, 1f, 0.2f), 90))
    }

    @Test
    fun uprightToSensor_rotation180() {
        assertRect(NRect(0.7f, 0.6f, 0.9f, 0.8f), GuideRegion.uprightToSensor(NRect(0.1f, 0.2f, 0.3f, 0.4f), 180))
    }

    @Test
    fun uprightToSensor_rotation270() {
        assertRect(NRect(0f, 0f, 0.2f, 0.1f), GuideRegion.uprightToSensor(NRect(0f, 0.8f, 0.1f, 1f), 270))
    }

    @Test
    fun strip_rechterRand() {
        assertRect(NRect(0.8f, 0.1f, 1f, 0.9f), GuideRegion.strip(NRect(0f, 0.1f, 1f, 0.9f)))
    }

    @Test
    fun contains_randInklusive() {
        val r = NRect(0.2f, 0.2f, 0.8f, 0.8f)
        assertTrue(r.contains(0.2f, 0.8f))
        assertFalse(r.contains(0.1f, 0.5f))
    }

    @Test
    fun artworkCandidates_mitteZuerstUndInnerhalbDesBildes() {
        // Umrandung wie am Geraet protokolliert (geraet-1-roh.log), Bild 1440x1920.
        val g = NRect(0.23501578f, 0.20780757f, 0.7649842f, 0.79219246f)
        val c = GuideRegion.artworkCandidates(g, 1440, 1920)
        assertEquals(5, c.size)
        // Mitte: Detektor-Box am Geraet (geraet-4-roh.log) 488,738-903,1145, Mittelpunkt (695, 941).
        assertEquals(695f, (c[0].x1 + c[0].x2) / 2, 5f)
        assertEquals(941f, (c[0].y1 + c[0].y2) / 2, 5f)
        assertEquals(415f * GuideRegion.ARTWORK_SCALE, c[0].x2 - c[0].x1, 10f)
        assertTrue(c[1].x1 < c[0].x1 && c[2].x1 > c[0].x1 && c[3].y1 < c[0].y1 && c[4].y1 > c[0].y1)
    }

    @Test
    fun artworkCandidates_amBildrandGeklemmt() {
        val c = GuideRegion.artworkCandidates(NRect(0f, 0f, 1f, 1f), 100, 100)
        for (b in c) assertTrue(b.x1 >= 0f && b.y1 >= 0f && b.x2 <= 100f && b.y2 <= 100f)
    }
}
