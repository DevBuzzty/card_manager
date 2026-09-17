package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap

/**
 * One recognised card: its detector box, matched passcode, cosine similarity, and the OCR text
 * read from its bottom-of-artwork zones (see [CardZones] / [CardLayout]), keyed by [Zone].
 * [legacyText] additionally carries the old full-width band's OCR (see [CardZones.legacyBand]) --
 * read by [HybridPipeline] as a safety net whenever the card's type (and so its exact zone
 * geometry) isn't known yet, or falls back to a placeholder layout. Both are empty only when
 * nothing was read this frame; the caller votes over them across frames to resolve the set code.
 */
data class Detection(
    val box: Box,
    val passcode: Int,
    val sim: Float,
    val zoneTexts: Map<Zone, String> = emptyMap(),
    val legacyText: String = ""
) {
    /** [zoneTexts] and [legacyText] concatenated into one string, for consumers that pattern-match
     *  over plain text (`OcrText.findPasscode`, `SetCodeOcr.extract`) rather than reading the
     *  per-zone breakdown a future per-zone vote would use. */
    fun allText(): String = concatZoneTexts(zoneTexts, legacyText)
}

/** Shared flattening used by [Detection.allText] and callers that don't have a [Detection] yet
 *  (e.g. [HybridPipeline], which needs the concatenated text to resolve a passcode BEFORE it can
 *  construct one). */
fun concatZoneTexts(zoneTexts: Map<Zone, String>, legacyText: String): String =
    (zoneTexts.values + legacyText).filter { it.isNotBlank() }.joinToString(" ")

/** A per-frame card recogniser: detect boxes and attach a passcode to each. */
interface CardPipeline {
    fun process(frame: Bitmap): List<Detection>

    /** [guide] = Scan-Umrandung, normiert im aufrechten Bild (siehe [GuideRegion]); null = unbekannt. */
    fun process(frame: Bitmap, guide: GuideRegion.NRect?): List<Detection> = process(frame)

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
    fun embedBox(frame: Bitmap, b: Box, minSim: Float = this.minSim): Detection? {
        val x = b.x1.toInt().coerceIn(0, frame.width - 1)
        val y = b.y1.toInt().coerceIn(0, frame.height - 1)
        val w = (b.x2 - b.x1).toInt().coerceIn(1, frame.width - x)
        val h = (b.y2 - b.y1).toInt().coerceIn(1, frame.height - y)
        val crop = Bitmap.createBitmap(frame, x, y, w, h)
        val square = ImagePrep.padToSquare224(crop)
        if (crop != frame) crop.recycle()  // guard: createBitmap may return `frame` for a full-frame box
        val (pc, sim) = index.search(embedder.embed(square))
        square.recycle()  // consumed synchronously by embed()
        return if (sim >= minSim) Detection(b, pc, sim) else null
    }

    override fun process(frame: Bitmap): List<Detection> =
        detectBoxes(frame).mapNotNull { embedBox(frame, it) }

    override fun close() {
        detector.close()
        embedder.close()
    }
}
