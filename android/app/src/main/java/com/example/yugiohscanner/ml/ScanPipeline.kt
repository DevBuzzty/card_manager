package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap

/** One recognised card: its detector box, matched passcode, and cosine similarity. */
data class Detection(val box: Box, val passcode: Int, val sim: Float)

/**
 * Full on-device recognition: detect card boxes, then for each box crop -> pad-to-square 224
 * -> embed -> nearest-neighbour index lookup. Detections below [minSim] are dropped.
 */
class ScanPipeline(context: Context, private val minSim: Float = 0.5f) {
    private val detector = DetectorModel(context)
    private val embedder = EmbedderModel(context)
    private val index = IndexSearcher(context)

    fun process(frame: Bitmap): List<Detection> {
        val out = ArrayList<Detection>()
        for (b in detector.detect(frame)) {
            val x = b.x1.toInt().coerceIn(0, frame.width - 1)
            val y = b.y1.toInt().coerceIn(0, frame.height - 1)
            val w = (b.x2 - b.x1).toInt().coerceIn(1, frame.width - x)
            val h = (b.y2 - b.y1).toInt().coerceIn(1, frame.height - y)
            val crop = Bitmap.createBitmap(frame, x, y, w, h)
            val square = ImagePrep.padToSquare224(crop)
            val (pc, sim) = index.search(embedder.embed(square))
            if (sim >= minSim) out.add(Detection(b, pc, sim))
        }
        return out
    }

    fun close() {
        detector.close()
        embedder.close()
    }
}
