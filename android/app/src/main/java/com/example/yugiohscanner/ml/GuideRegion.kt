package com.example.yugiohscanner.ml

/**
 * Umrechnung der Scan-Umrandung (ScanScreen, "Card Frame") in Kamerabild-Koordinaten -- reines
 * Kotlin, kein Android-Import. Siehe docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/brief.md.
 *
 * Drei Koordinatenraeume:
 * - View: Pixel der PreviewView (FILL_CENTER: Kamerabild skaliert, bis es die View fuellt, mittig beschnitten).
 * - Aufrecht: das um rotationDegrees gedrehte Kamerabild, normiert auf 0..1 (so sieht es auch die Erkennung).
 * - Sensor: das ungedrehte ImageProxy (Y-Ebene), normiert auf 0..1.
 */
object GuideRegion {

    data class NRect(val l: Float, val t: Float, val r: Float, val b: Float) {
        fun contains(x: Float, y: Float) = x in l..r && y in t..b
    }

    /** Anteil der Umrandungsbreite, den die Lichtschranke am rechten Rand einnimmt. */
    const val STRIP_FRACTION = 0.2f

    /** Umrandung in View-Pixeln -> normiert im aufrechten Kamerabild ([frameW]x[frameH] aufrecht). */
    fun viewToUpright(
        l: Float, t: Float, r: Float, b: Float,
        viewW: Float, viewH: Float, frameW: Int, frameH: Int,
    ): NRect {
        val sc = maxOf(viewW / frameW, viewH / frameH)
        val offX = (viewW - frameW * sc) / 2f
        val offY = (viewH - frameH * sc) / 2f
        fun nx(v: Float) = ((v - offX) / sc / frameW).coerceIn(0f, 1f)
        fun ny(v: Float) = ((v - offY) / sc / frameH).coerceIn(0f, 1f)
        return NRect(nx(l), ny(t), nx(r), ny(b))
    }

    /** Aufrecht-normiertes Rechteck -> Sensor-normiert, fuer die Y-Ebene des ImageProxy. */
    fun uprightToSensor(rect: NRect, rotationDegrees: Int): NRect {
        fun map(u: Float, v: Float): Pair<Float, Float> = when (((rotationDegrees % 360) + 360) % 360) {
            90 -> v to 1f - u
            180 -> 1f - u to 1f - v
            270 -> 1f - v to u
            else -> u to v
        }
        val a = map(rect.l, rect.t)
        val c = map(rect.r, rect.b)
        return NRect(minOf(a.first, c.first), minOf(a.second, c.second), maxOf(a.first, c.first), maxOf(a.second, c.second))
    }

    /** Lichtschranke: rechter Randstreifen der (aufrechten) Umrandung. */
    fun strip(rect: NRect): NRect = NRect(rect.r - (rect.r - rect.l) * STRIP_FRACTION, rect.t, rect.r, rect.b)
}
