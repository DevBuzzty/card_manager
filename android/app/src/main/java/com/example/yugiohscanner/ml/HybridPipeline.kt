package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Reliable hybrid recogniser. Per detected box it runs the artwork embedder (fast, accurate on
 * flat cards) and a targeted OCR of the card's bottom code band (foil-proof, angle-tolerant); the
 * embedder identifies flat cards, the band's passcode carries foils/angles. A whole-frame OCR runs
 * only as a throttled fallback when the detector boxes nothing (a card filling the frame). All feed
 * the same tracker/staging downstream.
 */
class HybridPipeline(context: Context, minSim: Float = 0.6f) : CardPipeline {
    private val artwork = ScanPipeline(context, minSim)
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var frameCount = 0

    override fun process(frame: Bitmap): List<Detection> {
        frameCount++
        val out = ArrayList<Detection>()
        // One detector pass finds ALL card boxes (foils included). For each box, read its bottom
        // code band ONCE (see CardStrip): that one OCR yields both the passcode (identity fallback)
        // and the set-code text (rarity, voted over frames downstream). Identity itself prefers the
        // artwork embedder when it matches (accurate on flat cards); on foils/angles, where the
        // embedder fails, the band's passcode carries it. On real printed cards the embedder usually
        // misses anyway, so this per-box OCR is close to what the reliable path already did.
        val boxes = artwork.detectBoxes(frame)
        for (b in boxes) {
            val bandText = readBand(frame, b)
            val embed = artwork.embedBox(frame, b)
            val passcode = embed?.passcode ?: (OcrText.findPasscode(bandText) ?: -1)
            val sim = embed?.sim ?: 1f
            if (passcode > 0 && out.none { it.passcode == passcode }) {
                out.add(Detection(b, passcode, sim, bandText))
            }
        }
        // Last-resort whole-frame OCR — for a card that fills the frame and slips past the detector,
        // so no box is produced. It's a speculative, expensive pass, so run it ONLY when the detector
        // found no boxes at all (when boxes existed, their targeted band OCR already covers them
        // better) and only every FULLFRAME_EVERY-th frame — pointless to burn OCR on every frame
        // while panning over an empty table.
        if (boxes.isEmpty() && frameCount % FULLFRAME_EVERY == 0) {
            val text = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0))).text
            val pc = OcrText.findPasscode(text)
            if (pc != null && pc > 0) {
                val w = frame.width.toFloat(); val h = frame.height.toFloat()
                out.add(Detection(Box(w * 0.18f, h * 0.12f, w * 0.82f, h * 0.88f, 1f), pc, 1f, text))
            }
        }
        return out
    }

    /** OCR the card's bottom code band and return its raw text (empty if the band is off-frame).
     *  The band (see [CardStrip]) holds the passcode bottom-left and the set code bottom-right,
     *  enhanced + upscaled for legibility. Runs on the analyzer's background thread. */
    private fun readBand(frame: Bitmap, b: Box): String {
        val strip = CardStrip.bottomBand(frame, b) ?: return ""
        val enhanced = OcrPrep.enhance(strip, targetWidth = 1000)
        strip.recycle()  // enhance() has copied it into `enhanced`
        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(enhanced, 0))).text
        enhanced.recycle()  // ML Kit is done once Tasks.await returns
        return text
    }

    override fun close() {
        artwork.close()
        recognizer.close()
    }

    companion object {
        // Run the whole-frame fallback OCR at most once every this many frames.
        private const val FULLFRAME_EVERY = 3
    }
}
