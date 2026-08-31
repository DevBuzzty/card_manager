package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap

/**
 * Detect card boxes, then identify each card by OCR-reading its 8-digit passcode from the
 * bottom-left corner (where it's printed). Drop-in replacement for the artwork embedder.
 *
 * A box whose passcode can't be read this frame still yields a Detection with passcode = -1,
 * so the box keeps tracking across frames; BoxTracker ignores negative passcodes when voting.
 * sim is a constant 1.0 (OCR gives an exact id, not a similarity).
 */
class PasscodePipeline(context: Context) : CardPipeline {
    private val detector = DetectorModel(context)
    private val ocr = PasscodeOcr()

    override fun process(frame: Bitmap): List<Detection> {
        val out = ArrayList<Detection>()
        for (b in detector.detect(frame)) {
            val x = b.x1.toInt().coerceIn(0, frame.width - 1)
            val y = b.y1.toInt().coerceIn(0, frame.height - 1)
            val w = (b.x2 - b.x1).toInt().coerceIn(1, frame.width - x)
            val h = (b.y2 - b.y1).toInt().coerceIn(1, frame.height - y)
            val region = passcodeRegion(frame, x, y, w, h)
            val pc = region?.let { try { ocr.read(it) } catch (e: Exception) { null } }
            out.add(Detection(b, pc ?: -1, 1f))
        }
        return out
    }

    // Bottom-left ~fifth of the card — where the passcode is printed — upscaled 3x so ML Kit
    // can resolve the tiny digits even when the card is small in the frame.
    private fun passcodeRegion(frame: Bitmap, x: Int, y: Int, w: Int, h: Int): Bitmap? {
        val ry = (y + h * 0.80f).toInt().coerceIn(0, frame.height - 1)
        val rh = (h * 0.20f).toInt().coerceIn(1, frame.height - ry)
        val rw = (w * 0.62f).toInt().coerceIn(1, w)
        if (rw < 4 || rh < 4) return null
        val strip = Bitmap.createBitmap(frame, x, ry, rw, rh)
        return Bitmap.createScaledBitmap(strip, rw * 3, rh * 3, true)
    }

    override fun close() {
        detector.close()
        ocr.close()
    }
}
