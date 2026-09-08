package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.RectF

/**
 * Crops a detected card frame into per-zone, OCR-ready bitmaps using [CardLayout]'s measured
 * geometry, instead of [CardStrip.bottomBand]'s one full-width band.
 *
 * [CardLayout.zones] rects are in artwork-box units -- same convention as [CardStrip]: `left`/
 * `right` are fractions of box WIDTH from the box's LEFT edge (`box.x1`); `top`/`bottom` are
 * fractions of box HEIGHT from the box's BOTTOM edge (`box.y2`), growing downward. Values can be
 * negative or exceed 1 -- the set code straddles the artwork's lower edge, the passcode starts
 * left of the box. [cropZone] mirrors [CardStrip.bottomBand]'s arithmetic exactly, per zone
 * instead of one shared band.
 */
object CardZones {

    /**
     * Crop every zone [CardLayout.zones] defines for [layout] out of [frame] at [box]. A zone
     * that lands off-frame or degenerates below a few pixels is simply absent from the result
     * (never thrown, never a degenerate placeholder bitmap) -- this also means the result never
     * contains [Zone.EDITION], since [CardLayout.zones] never returns it.
     *
     * Each zone is run through its own [OcrPrep.enhance] pass rather than a shared one: PASSCODE
     * and SET_CODE have very different aspect ratios, and `enhance` scales by a fixed target
     * width, so sharing one enhanced image would upscale one of them wrongly. They also get
     * different `contrast` values -- see [contrastFor].
     *
     * For [Layout.PENDULUM], [Layout.SKILL] and [Layout.LEGACY] -- the layouts with no measured
     * geometry, where [CardLayout.zones] returns STANDARD's rects as an explicit placeholder --
     * callers should also fetch [legacyBand] as a safety net: a misplaced zone finds nothing,
     * but the old full-width band occasionally still does.
     *
     * Ownership: the caller owns every [Bitmap] in the returned map and must recycle it once
     * done. This function recycles its own pre-enhance intermediate crops internally and does
     * not leak them.
     */
    fun crop(frame: Bitmap, box: Box, layout: Layout): Map<Zone, Bitmap> = buildMap {
        for ((zone, rect) in CardLayout.zones(layout)) {
            val bitmap = cropZone(frame, box, rect, contrastFor(zone)) ?: continue
            put(zone, bitmap)
        }
    }

    /**
     * The legacy full-width code band (see [CardStrip.bottomBand]), enhanced the same way as
     * [crop]'s zones; null if it lands off-frame. Exposed as a separate function rather than a
     * map entry because it is not a [CardLayout] zone -- [Zone] lives in `CardLayout.kt`, which
     * this task must not touch, and it would be wrong to fabricate or overload an existing [Zone]
     * key for it. Callers own the returned [Bitmap] and must recycle it.
     */
    fun legacyBand(frame: Bitmap, box: Box): Bitmap? {
        val strip = CardStrip.bottomBand(frame, box) ?: return null
        val enhanced = OcrPrep.enhance(strip)
        strip.recycle()  // enhance() has copied it into `enhanced`
        return enhanced
    }

    /** Convert one box-relative [rect] to frame pixels, clamp to [frame], crop, and enhance with
     *  [contrast]. Null if the zone lands off-frame or is too small to be useful. Mirrors
     *  [CardStrip.bottomBand]'s clamping arithmetic. */
    private fun cropZone(frame: Bitmap, box: Box, rect: RectF, contrast: Float): Bitmap? {
        val (x, y, w, h) = zoneRect(box, rect, frame.width, frame.height) ?: return null

        val crop = Bitmap.createBitmap(frame, x, y, w, h)
        val enhanced = OcrPrep.enhance(crop, contrast = contrast)
        if (crop != frame) crop.recycle()  // guard: createBitmap may return `frame` for a full-frame rect
        return enhanced
    }

    /**
     * Per-zone contrast for [OcrPrep.enhance]. Task 8 (Spec D2) measured this on-device against
     * `ml/ocr_bench.py`'s 445-image corpus (`ml/ocr_bench/report-2026-09-07.md` baseline):
     *
     *  | SET_CODE contrast | ebay STANDARD | ebay SPELL_TRAP | ebay LINK |
     *  |---|---|---|---|
     *  | 2.2  | 27.3% | 15.0% | 0.0%  |
     *  | 1.5 (old shared default) | 42.2% | 36.7% | 25.0% |
     *  | 1.15 | 49.2% | 41.7% | 25.0% |
     *  | **1.0 (no contrast boost at all -- chosen)** | **53.9%** | **45.0%** | **41.7%** |
     *  | 0.7  | 49.2% | 31.7% | 41.7% |
     *
     * A clean peak at 1.0, monotonic on both sides -- not a cliff edge picked by one lucky
     * measurement. The 1.5 pivot every zone shared before this task over-contrasts SET_CODE
     * specifically: its crop straddles the artwork's lower edge (see class doc), so part of it is
     * actual card art, and the fixed contrast curve was pushing that art's mid-tones toward flat
     * black/white right along with the text, adding noise instead of removing it. PASSCODE sits on
     * a plain background and keeps the original 1.5 -- changing it was never part of this
     * comparison and it is not touched here.
     */
    internal fun contrastFor(zone: Zone): Float = when (zone) {
        Zone.SET_CODE -> 1.0f
        else -> 1.5f
    }

    /**
     * Pure coordinate math: [rect] (box-relative, see class doc for the convention) to frame
     * pixels for a [box] detected in a [frameW]x[frameH] frame, clamped to the frame. Null if the
     * zone lands off-frame or degenerates to fewer than 6px on either side. Split out from
     * [cropZone] so the arithmetic -- the part that must not be wrong -- is unit-testable without
     * touching [Bitmap], which has no working stub under this module's JVM unit tests.
     */
    internal fun zoneRect(box: Box, rect: RectF, frameW: Int, frameH: Int): IntArray? {
        val bw = box.x2 - box.x1
        val bh = box.y2 - box.y1
        val left = box.x1 + rect.left * bw
        val top = box.y2 + rect.top * bh
        val right = box.x1 + rect.right * bw
        val bottom = box.y2 + rect.bottom * bh

        val x = left.toInt().coerceIn(0, frameW - 1)
        val y = top.toInt().coerceIn(0, frameH - 1)
        val w = (right - left).toInt().coerceIn(1, frameW - x)
        val h = (bottom - top).toInt().coerceIn(1, frameH - y)
        if (w < 6 || h < 6) return null

        return intArrayOf(x, y, w, h)
    }
}
