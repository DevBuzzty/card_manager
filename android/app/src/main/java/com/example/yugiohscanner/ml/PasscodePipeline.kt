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
            val region = passcodeRegion(frame, b)
            val pc = region?.let { try { ocr.read(it) } catch (e: Exception) { null } }
            out.add(Detection(b, pc ?: -1, 1f))
        }
        return out
    }

    // The detector boxes the ARTWORK (card middle). The passcode is printed near the card's
    // bottom edge, i.e. BELOW the artwork box. Crop a band below the box (bottom-left, where
    // the 8-digit code sits), upscaled 3x so ML Kit can resolve the tiny digits.
    private fun passcodeRegion(frame: Bitmap, b: Box): Bitmap? {
        val bw = b.x2 - b.x1
        val bh = b.y2 - b.y1
        val rx = (b.x1 - 0.06f * bw).toInt().coerceIn(0, frame.width - 1)
        val ry = (b.y2 + 0.30f * bh).toInt().coerceIn(0, frame.height - 1)
        val rw = (0.62f * bw).toInt().coerceIn(1, frame.width - rx)
        val rh = (0.65f * bh).toInt().coerceIn(1, frame.height - ry)
        if (rw < 6 || rh < 6) return null
        val strip = Bitmap.createBitmap(frame, rx, ry, rw, rh)
        return Bitmap.createScaledBitmap(strip, rw * 3, rh * 3, true)
    }

    override fun close() {
        detector.close()
        ocr.close()
    }
}
