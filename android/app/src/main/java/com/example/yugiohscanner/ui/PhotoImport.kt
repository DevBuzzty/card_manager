package com.example.yugiohscanner.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Spec H3b1 §6 -- Foto (Kamera-Datei oder Galerie) vor dem Hochladen verkleinern: längste Seite ≤ 1600 px, JPEG < 500 KB,
 * mindestens 500 px (eBay). Regeln in ml/PhotoScale.kt (Zwilling der PC-Grenzen).
 *
 * Ausrichtung (Kontext Task 9, weicht von der ursprünglichen Brief-Vorlage ab): erst auf Zielgröße skalieren, dann
 * getPixels -> [PhotoScale.orientPixels] (Pixel-Zwilling von listing-photos.cjs#orientBitmap, alle 8 EXIF-Fälle
 * inkl. Spiegelung) -> Bitmap.createBitmap, bevor JPEG kodiert wird. [PhotoScale.rotationForExif] deckt nur 4 von 8
 * Fällen ohne Spiegelung ab und wird hier bewusst NICHT verwendet. Große Bilder werden mit inSampleSize dekodiert,
 * alle Zwischen-Bitmaps recycelt (Abschluss-Fix C6: im finally, auch bei Fehlern).
 */
object PhotoImport {
    private const val UNREADABLE = "Foto konnte nicht gelesen werden."
    const val CAMERA_DIR = "listing_photos"

    // Abschluss-Fix C6: ein zu großes Foto (OutOfMemoryError beim Dekodieren/Kodieren) wird zur Meldung statt Absturz.
    private const val TOO_BIG = "Foto zu groß."

    suspend fun jpegFrom(ctx: Context, uri: Uri): ByteArray = withContext(Dispatchers.IO) {
        try { convert(ctx, uri) } catch (e: OutOfMemoryError) { throw IllegalArgumentException(TOO_BIG) }
    }

    private fun convert(ctx: Context, uri: Uri): ByteArray {
        val cr = ctx.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: throw IllegalArgumentException(UNREADABLE)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException(UNREADABLE)
        if (maxOf(bounds.outWidth, bounds.outHeight) < PhotoScale.MIN_EDGE) throw IllegalArgumentException(PhotoScale.TOO_SMALL)

        // Abschluss-Fix C6: alle Zwischen-Bitmaps im finally recyceln, auch wenn unterwegs etwas scheitert
        // (recycle() auf einem schon recycelten Bitmap ist wirkungslos).
        var decoded: Bitmap? = null
        var scaled: Bitmap? = null
        var oriented: Bitmap? = null
        try {
            val opts = BitmapFactory.Options().apply { inSampleSize = PhotoScale.sampleSize(bounds.outWidth, bounds.outHeight) }
            val d = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw IllegalArgumentException(UNREADABLE)
            decoded = d
            val orientation = cr.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
                ?: ExifInterface.ORIENTATION_NORMAL

            val (w, h) = PhotoScale.scaleSize(d.width, d.height)
            val sc = if (w == d.width && h == d.height) d else Bitmap.createScaledBitmap(d, w, h, true)
            scaled = sc
            if (sc !== d) d.recycle()

            val px = IntArray(w * h)
            sc.getPixels(px, 0, w, 0, 0, w, h)
            sc.recycle()
            val (outPx, outW, outH) = PhotoScale.orientPixels(px, w, h, orientation)

            val o = Bitmap.createBitmap(outPx, outW, outH, Bitmap.Config.ARGB_8888)
            oriented = o
            return PhotoScale.encodeUnder({ q -> ByteArrayOutputStream().also { o.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray() })
        } finally {
            oriented?.recycle(); scaled?.recycle(); decoded?.recycle()
        }
    }

    /** Ziel-Datei für die Kamera (TakePicture) im freigegebenen Cache-Ordner; wird bei jeder Aufnahme überschrieben. */
    fun cameraUri(ctx: Context): Uri {
        val f = File(File(ctx.cacheDir, CAMERA_DIR).apply { mkdirs() }, "aufnahme.jpg")
        return FileProvider.getUriForFile(ctx, ctx.packageName + ListingShare.AUTHORITY_SUFFIX, f)
    }
}
