package com.example.yugiohscanner

import org.junit.Assert.assertEquals
import org.junit.Test

/** Der gemerkte Zoom muss in das passen, was die Kamera dieses Geraets kann -- sonst wirft
 *  setZoomRatio. */
class ZoomTest {

    @Test
    fun `ein Wert im Bereich bleibt unveraendert`() {
        assertEquals(2.5f, Prefs.zoomGeklemmt(2.5f, 1f, 5f), 0.001f)
        assertEquals(1f, Prefs.zoomGeklemmt(1f, 1f, 5f), 0.001f)
    }

    @Test
    fun `ein zu grosser Wert wird auf das Machbare gestutzt`() {
        // Anderes Geraet, engerer Bereich: der gemerkte 4x darf nicht ungeprueft in die Kamera.
        assertEquals(2f, Prefs.zoomGeklemmt(4f, 1f, 2f), 0.001f)
    }

    @Test
    fun `ein zu kleiner Wert steigt auf das Minimum`() {
        // Weitwinkel-Kameras koennen unter 1 gehen; tun sie es nicht, ist 1 die Untergrenze.
        assertEquals(1f, Prefs.zoomGeklemmt(0.2f, 1f, 5f), 0.001f)
        assertEquals(0.5f, Prefs.zoomGeklemmt(0.2f, 0.5f, 5f), 0.001f)
    }

    @Test
    fun `kaputte Werte landen nie in der Kamera`() {
        assertEquals(1f, Prefs.zoomGeklemmt(Float.NaN, 1f, 5f), 0.001f)
        assertEquals(1f, Prefs.zoomGeklemmt(Float.POSITIVE_INFINITY, 1f, 5f), 0.001f)
        assertEquals(1f, Prefs.zoomGeklemmt(2f, 5f, 1f), 0.001f)   // verdrehte Grenzen
    }
}
