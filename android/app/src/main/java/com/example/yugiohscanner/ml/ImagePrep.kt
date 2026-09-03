package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color

/**
 * Image preprocessing shared by the on-device models. The embedder path MUST match the
 * Python training/index pipeline exactly (compose_scene.pad_to_square(fill=127) +
 * dataset.to_model_tensor: RGB, /255, ImageNet mean/std, CHW).
 */
object ImagePrep {
    private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)

    /** Pad to a gray(127) square with the source centered, then scale to 224. */
    fun padToSquare224(src: Bitmap): Bitmap {
        val side = maxOf(src.width, src.height)
        val square = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val c = Canvas(square)
        c.drawColor(Color.rgb(127, 127, 127))
        c.drawBitmap(src, (side - src.width) / 2f, (side - src.height) / 2f, null)
        val scaled = Bitmap.createScaledBitmap(square, 224, 224, true)
        if (scaled != square) square.recycle()  // guard: returns `square` when side already == 224
        return scaled
    }

    /** 224x224 RGB bitmap -> ImageNet-normalised CHW float[1*3*224*224]. */
    fun embedderInput(bmp224: Bitmap): FloatArray {
        val n = 224 * 224
        val px = IntArray(n)
        bmp224.getPixels(px, 0, 224, 0, 0, 224, 224)
        val out = FloatArray(3 * n)
        for (i in 0 until n) {
            val p = px[i]
            val r = ((p shr 16) and 0xFF) / 255f
            val g = ((p shr 8) and 0xFF) / 255f
            val b = (p and 0xFF) / 255f
            out[i] = (r - MEAN[0]) / STD[0]
            out[n + i] = (g - MEAN[1]) / STD[1]
            out[2 * n + i] = (b - MEAN[2]) / STD[2]
        }
        return out
    }
}
