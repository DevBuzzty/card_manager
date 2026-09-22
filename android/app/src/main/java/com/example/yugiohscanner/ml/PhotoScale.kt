package com.example.yugiohscanner.ml

/**
 * Spec H3b1 §6 -- reine Regeln für eigene Fotos, gleiche Grenzen wie desktop/electron/listing-photos.cjs
 * (MAX_EDGE 1600, MIN_EDGE 500, Ziel < 500 KB, Qualitätsstufen 85/75/65/55/50, höchstens 12, Pfad <listing_id>/<uuid>.jpg).
 * Adresse wie supabase/functions/_shared/ebay-map.ts#photoUrl.
 *
 * EXIF-Ausrichtung (Zusatz zur Task-8-Vorlage, Fixrunde 1): die PC-Seite dreht/spiegelt Fotos jetzt vor dem Skalieren
 * laut EXIF-Orientation-Tag (listing-photos.cjs#jpegOrientation/orientBitmap), sonst landen Hochformat-Handyfotos
 * seitlich auf eBay. [orientPixels] ist der Pixel-Zwilling von orientBitmap (ein Int je Pixel statt 4 Byte BGRA,
 * sonst dieselben Formeln je Orientation-Wert 1..8) und damit die verbindliche Ausrichtungslogik. Die spätere
 * Verdrahtung (Task 9) sieht so aus: erst mit [scaleSize]/[sampleSize] auf Zielgröße bringen, dann
 * `bitmap.getPixels(px, 0, w, 0, 0, w, h)` -> [orientPixels] -> `Bitmap.createBitmap(px, outW, outH, ARGB_8888)`,
 * bevor mit [encodeUnder] JPEG-kodiert wird. Das tatsächliche Dekodieren/EXIF-Lesen (android.media.ExifInterface aus
 * dem Dateipuffer, Bitmap-Erzeugung) gehört zur Aufnahme-Oberfläche und ist hier bewusst nicht verdrahtet, weil
 * Task 8 nur die Datenschicht liefert.
 */
object PhotoScale {
    const val MAX_PHOTOS = 12
    const val MAX_EDGE = 1600
    const val MIN_EDGE = 500
    const val TARGET_BYTES = 500 * 1024
    val QUALITIES = listOf(85, 75, 65, 55, 50)
    const val BUCKET = "listing-photos"
    const val TOO_SMALL = "Foto zu klein – mindestens 500 Pixel an der längeren Seite."
    const val TOO_MANY = "Höchstens 12 eigene Fotos je Angebot."

    /** Zielgröße: längste Seite höchstens [maxEdge], Seitenverhältnis bleibt (java.lang.Math.round wie JS Math.round). */
    fun scaleSize(width: Int, height: Int, maxEdge: Int = MAX_EDGE): Pair<Int, Int> {
        val m = maxOf(width, height)
        if (m <= maxEdge) return width to height
        val f = maxEdge.toDouble() / m
        return maxOf(1, Math.round(width * f).toInt()) to maxOf(1, Math.round(height * f).toInt())
    }

    /** BitmapFactory.inSampleSize: größte Zweierpotenz, bei der die längste Seite noch >= [maxEdge] bleibt. */
    fun sampleSize(width: Int, height: Int, maxEdge: Int = MAX_EDGE): Int {
        var s = 1
        while (maxOf(width, height) / (s * 2) >= maxEdge) s *= 2
        return s
    }

    /** Qualität senken, bis unter dem Ziel; die letzte Stufe wird genommen, wie sie ist. */
    fun encodeUnder(encode: (Int) -> ByteArray, target: Int = TARGET_BYTES): ByteArray {
        var last = ByteArray(0)
        for (q in QUALITIES) { last = encode(q); if (last.size < target) return last }
        return last
    }

    /**
     * EXIF-Ausrichtung -> Drehung in Grad (6 = 90°, 3 = 180°, 8 = 270°, sonst 0). Deckt nur 4 der 8 Tag-Werte ab
     * (keine Spiegelung für 2/4/5/7) -- aus der Task-8-Vorlage übernommen, weiterhin vom Literal-Test geprüft.
     * **Für die tatsächliche Ausrichtung ist [orientPixels] verbindlich**, nicht diese Funktion.
     */
    fun rotationForExif(orientation: Int): Int = when (orientation) { 6 -> 90; 3 -> 180; 8 -> 270; else -> 0 }

    /**
     * Pixel-Zwilling von listing-photos.cjs#orientBitmap: exakt dieselben Formeln (Ausgabe-Pixel (ox,oy) ->
     * Quell-Pixel (ix,iy)) je EXIF-Orientation-Wert 1..8, hier auf einem Int-je-Pixel-Feld (wie
     * Bitmap.getPixels/createBitmap) statt 4-Byte-BGRA. Breite/Höhe vertauschen bei 5..8 (swapped). Unbekannte
     * Werte (auch 1) -> unverändert. Rückgabe: (Pixel, Breite, Höhe) des gedrehten Bilds.
     */
    fun orientPixels(px: IntArray, w: Int, h: Int, orientation: Int): Triple<IntArray, Int, Int> {
        val swapped = orientation in 5..8
        val outW = if (swapped) h else w
        val outH = if (swapped) w else h
        val out = IntArray(outW * outH)
        for (oy in 0 until outH) {
            for (ox in 0 until outW) {
                val ix: Int
                val iy: Int
                when (orientation) {
                    2 -> { ix = w - 1 - ox; iy = oy }
                    3 -> { ix = w - 1 - ox; iy = h - 1 - oy }
                    4 -> { ix = ox; iy = h - 1 - oy }
                    5 -> { ix = oy; iy = ox }
                    6 -> { ix = oy; iy = h - 1 - ox }
                    7 -> { ix = w - 1 - oy; iy = h - 1 - ox }
                    8 -> { ix = w - 1 - oy; iy = ox }
                    else -> { ix = ox; iy = oy }
                }
                out[oy * outW + ox] = px[iy * w + ix]
            }
        }
        return Triple(out, outW, outH)
    }

    fun photoPath(listingId: String, uuid: String): String = "$listingId/$uuid.jpg"

    /** Pfade bestehen nur aus UUID-Zeichen; URLEncoder genügt dort (gleiches Ergebnis wie encodeURIComponent). */
    fun publicUrl(baseUrl: String, path: String): String =
        baseUrl.trimEnd('/').removeSuffix("/rest/v1") + "/storage/v1/object/public/$BUCKET/" +
            path.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
}
