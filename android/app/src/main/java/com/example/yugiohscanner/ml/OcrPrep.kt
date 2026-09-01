package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect

/**
 * Preprocess a crop for OCR: upscale small text, convert to grayscale, and boost contrast — the
 * printed passcode / set code is tiny, and ML Kit reads a big, high-contrast strip far better than
 * the raw crop. Uses a ColorMatrix (GPU-cheap), no per-pixel loop.
 */
object OcrPrep {
    fun enhance(src: Bitmap, targetWidth: Int = 1000, contrast: Float = 1.5f): Bitmap {
        val scale = (targetWidth.toFloat() / src.width).coerceIn(1f, 4f)
        val w = (src.width * scale).toInt().coerceAtLeast(1)
        val h = (src.height * scale).toInt().coerceAtLeast(1)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)

        val cm = ColorMatrix().apply { setSaturation(0f) }          // grayscale
        val t = (0.5f - 0.5f * contrast) * 255f                     // pivot contrast around mid-gray
        cm.postConcat(ColorMatrix(floatArrayOf(
            contrast, 0f, 0f, 0f, t,
            0f, contrast, 0f, 0f, t,
            0f, 0f, contrast, 0f, t,
            0f, 0f, 0f, 1f, 0f,
        )))
        val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(cm) }
        Canvas(out).drawBitmap(src, null, Rect(0, 0, w, h), paint)
        return out
    }
}
