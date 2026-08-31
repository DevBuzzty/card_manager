package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.regex.Pattern

/**
 * Reliable hybrid recogniser: runs the artwork embedder (fast, multi-card, but weak on foils and
 * wide angles) AND a full-frame passcode OCR (foil-proof, angle-tolerant, single card) on every
 * frame, and merges the results. Foils / hard angles are caught by the OCR; well-lit flat cards
 * get the instant artwork match. Both feed the same tracker/staging downstream.
 */
class HybridPipeline(context: Context, minSim: Float = 0.6f) : CardPipeline {
    private val artwork = ScanPipeline(context, minSim)
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val passcodeRe = Pattern.compile("\\b\\d{8}\\b")

    override fun process(frame: Bitmap): List<Detection> {
        val dets = artwork.process(frame)
        val pc = readPasscode(frame)
        // Only add the OCR result if the embedder didn't already identify that card this frame.
        if (pc != null && pc > 0 && dets.none { it.passcode == pc }) {
            // A central box just for the overlay (the OCR reads the whole frame anyway).
            val w = frame.width.toFloat(); val h = frame.height.toFloat()
            val box = Box(w * 0.18f, h * 0.12f, w * 0.82f, h * 0.88f, 1f)
            return dets + Detection(box, pc, 1f)
        }
        return dets
    }

    /** Synchronous full-frame 8-digit passcode read (runs on the analyzer's background thread). */
    private fun readPasscode(frame: Bitmap): Int? {
        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0)))
        for (block in text.textBlocks) {
            val m = passcodeRe.matcher(block.text)
            if (m.find()) return m.group().toIntOrNull()
        }
        return null
    }

    override fun close() {
        artwork.close()
        recognizer.close()
    }
}
