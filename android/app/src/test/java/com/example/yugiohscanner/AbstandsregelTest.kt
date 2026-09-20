package com.example.yugiohscanner

import com.example.yugiohscanner.ml.akzeptiert
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Werte aus dem Scan-Protokoll 19.09. (Glitzer-Karten, bester Treffer richtig). */
class AbstandsregelTest {
    @Test fun `ueber der Schwelle immer`() = assertTrue(akzeptiert(0.61f, 0.60f, 0.6f, true))
    @Test fun `Glitzer-Karte mit klarem Vorsprung`() = assertTrue(akzeptiert(0.534f, 0.447f, 0.6f, true))
    @Test fun `knapp unter der Schwelle ohne Vorsprung nicht`() = assertFalse(akzeptiert(0.55f, 0.50f, 0.6f, true))
    @Test fun `zu niedrig trotz Vorsprung nicht`() = assertFalse(akzeptiert(0.44f, 0.10f, 0.6f, true))
    @Test fun `Umrandungs-Suche ohne Abstandsregel`() = assertFalse(akzeptiert(0.65f, 0.30f, 0.7f, false))
}
