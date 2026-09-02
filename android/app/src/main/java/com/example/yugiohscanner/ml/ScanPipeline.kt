package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap

/**
 * One recognised card: its detector box, matched passcode, cosine similarity, and the raw OCR
 * text of this card's bottom code band (passcode + set code live there). [bandText] is empty only
 * when no band was read this frame; the caller votes over it across frames to resolve the set code.
 */
data class Detection(
    val box: Box,
    val passcode: Int,
    val sim: Float,
    val bandText: String = ""
)

/** A per-frame card recogniser: detect boxes and attach a passcode to each. */
interface CardPipeline {
    fun process(frame: Bitmap): List<Detection>
    fun close()
}

/**
 * Full on-device recognition: detect card boxes, then for each box crop -> pad-to-square 224
 * -> embed -> nearest-neighbour index lookup. Detections below [minSim] are dropped.
 */
class ScanPipeline(context: Context, private val minSim: Float = 0.5f) : CardPipeline {
    private val detector = DetectorModel(context)
    private val embedder = EmbedderModel(context)
    private val index = IndexSearcher(context)

    /** Just the detector boxes (robust — finds foils/angled cards the embedder can't match). */
    fun detectBoxes(frame: Bitmap): List<Box> = detector.detect(frame)

    /** Embed one detector box and match it against the index; null if below [minSim]. */
    fun embedBox(frame: Bitmap, b: Box): Detection? {
        val x = b.x1.toInt().coerceIn(0, frame.width - 1)
        val y = b.y1.toInt().coerceIn(0, frame.height - 1)
        val w = (b.x2 - b.x1).toInt().coerceIn(1, frame.width - x)
        val h = (b.y2 - b.y1).toInt().coerceIn(1, frame.height - y)
        val crop = Bitmap.createBitmap(frame, x, y, w, h)
        val (pc, sim) = index.search(embedder.embed(ImagePrep.padToSquare224(crop)))
        return if (sim >= minSim) Detection(b, pc, sim) else null
    }

    override fun process(frame: Bitmap): List<Detection> =
        detectBoxes(frame).mapNotNull { embedBox(frame, it) }

    override fun close() {
        detector.close()
        embedder.close()
    }
}
