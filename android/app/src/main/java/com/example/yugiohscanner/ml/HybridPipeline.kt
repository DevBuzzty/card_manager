package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Reliable hybrid recogniser: runs the artwork embedder (fast, multi-card, but weak on foils and
 * wide angles) AND a full-frame passcode OCR (foil-proof, angle-tolerant, single card) on every
 * frame, and merges the results. Foils / hard angles are caught by the OCR; well-lit flat cards
 * get the instant artwork match. Both feed the same tracker/staging downstream.
 */
class HybridPipeline(context: Context, minSim: Float = 0.6f) : CardPipeline {
    private val artwork = ScanPipeline(context, minSim)
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    override fun process(frame: Bitmap): List<Detection> {
        val out = ArrayList<Detection>()
        // One detector pass finds ALL card boxes (foils included). Each box: try the artwork
        // embedder first (fast, flat cards); if it can't match (foil/angle), read the passcode
        // from that card's printed strip — a targeted, upscaled, high-contrast crop, not the
        // whole frame — which is what makes the OCR reliable.
        for (b in artwork.detectBoxes(frame)) {
            val d = artwork.embedBox(frame, b)
            if (d != null) { out.add(d); continue }
            val pc = readPasscodeFromBox(frame, b)
            if (pc != null && pc > 0 && out.none { it.passcode == pc }) out.add(Detection(b, pc, 1f))
        }
        // Last resort — nothing identified (e.g. card fills the frame / detector missed it): OCR
        // the whole frame.
        if (out.isEmpty()) {
            val pc = OcrText.findPasscode(Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0))).text)
            if (pc != null && pc > 0) {
                val w = frame.width.toFloat(); val h = frame.height.toFloat()
                out.add(Detection(Box(w * 0.18f, h * 0.12f, w * 0.82f, h * 0.88f, 1f), pc, 1f))
            }
        }
        return out
    }

    /** OCR the 8-digit passcode from the strip printed just below the artwork box (bottom-left of
     *  the card), enhanced + upscaled for legibility. Runs on the analyzer's background thread. */
    private fun readPasscodeFromBox(frame: Bitmap, b: Box): Int? {
        val bw = b.x2 - b.x1; val bh = b.y2 - b.y1
        val cx = (b.x1 - bw * 0.05f).toInt().coerceIn(0, frame.width - 1)
        val cy = (b.y2 - bh * 0.05f).toInt().coerceIn(0, frame.height - 1)
        val cw = (bw * 1.10f).toInt().coerceIn(1, frame.width - cx)
        val ch = (bh * 0.55f).toInt().coerceIn(1, frame.height - cy)
        val strip = Bitmap.createBitmap(frame, cx, cy, cw, ch)
        val enhanced = OcrPrep.enhance(strip, targetWidth = 1000)
        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(enhanced, 0)))
        return OcrText.findPasscode(text.text)
    }

    override fun close() {
        artwork.close()
        recognizer.close()
    }
}
