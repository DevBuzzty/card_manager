package com.example.yugiohscanner.ml

/**
 * Spec H3b1 §6 -- reine Regeln für eigene Fotos, gleiche Grenzen wie desktop/electron/listing-photos.cjs
 * (MAX_EDGE 1600, MIN_EDGE 500, Ziel < 500 KB, Qualitätsstufen 85/75/65/55/50, höchstens 12, Pfad <listing_id>/<uuid>.jpg).
 * Adresse wie supabase/functions/_shared/ebay-map.ts#photoUrl.
 *
 * EXIF-Ausrichtung (Zusatz zur Task-8-Vorlage): die PC-Seite dreht/spiegelt Fotos jetzt vor dem Skalieren laut
 * EXIF-Orientation-Tag (listing-photos.cjs#jpegOrientation/orientBitmap), sonst landen Hochformat-Handyfotos seitlich
 * auf eBay. [exifTransform] ist die reine Rechenlogik dafür (welche Drehung + Spiegelung je Tag-Wert 1..8); das
 * tatsächliche Dekodieren/Drehen der Bitmap (android.graphics.Matrix, ExifInterface aus dem Dateipuffer) gehört zur
 * Aufnahme-Oberfläche und ist hier bewusst nicht verdrahtet, weil Task 8 nur die Datenschicht liefert.
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

    /** EXIF-Ausrichtung -> Drehung in Grad (6 = 90°, 3 = 180°, 8 = 270°, sonst 0). */
    fun rotationForExif(orientation: Int): Int = when (orientation) { 6 -> 90; 3 -> 180; 8 -> 270; else -> 0 }

    /**
     * Vollständige EXIF-Ausrichtung (1..8) -> Drehung (im Uhrzeigersinn) + waagrechte Spiegelung, angewandt VOR der
     * Drehung. Gleiche Tabelle wie orientBitmap am PC (2/4/5/7 spiegeln zusätzlich). Unbekannte Werte -> keine Wirkung.
     */
    data class ExifTransform(val rotationDegrees: Int, val mirrorHorizontal: Boolean)
    fun exifTransform(orientation: Int): ExifTransform = when (orientation) {
        2 -> ExifTransform(0, true)
        3 -> ExifTransform(180, false)
        4 -> ExifTransform(180, true)
        5 -> ExifTransform(90, true)
        6 -> ExifTransform(90, false)
        7 -> ExifTransform(270, true)
        8 -> ExifTransform(270, false)
        else -> ExifTransform(0, false)
    }

    fun photoPath(listingId: String, uuid: String): String = "$listingId/$uuid.jpg"

    /** Pfade bestehen nur aus UUID-Zeichen; URLEncoder genügt dort (gleiches Ergebnis wie encodeURIComponent). */
    fun publicUrl(baseUrl: String, path: String): String =
        baseUrl.trimEnd('/').removeSuffix("/rest/v1") + "/storage/v1/object/public/$BUCKET/" +
            path.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
}
