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
     * width, so sharing one enhanced image would upscale one of them wrongly.
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
            val bitmap = cropZone(frame, box, rect) ?: continue
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

    /** Convert one box-relative [rect] to frame pixels, clamp to [frame], crop, and enhance.
     *  Null if the zone lands off-frame or is too small to be useful. Mirrors
     *  [CardStrip.bottomBand]'s clamping arithmetic. */
    private fun cropZone(frame: Bitmap, box: Box, rect: RectF): Bitmap? {
        val bw = box.x2 - box.x1
        val bh = box.y2 - box.y1
        val left = box.x1 + rect.left * bw
        val top = box.y2 + rect.top * bh
        val right = box.x1 + rect.right * bw
        val bottom = box.y2 + rect.bottom * bh

        val x = left.toInt().coerceIn(0, frame.width - 1)
        val y = top.toInt().coerceIn(0, frame.height - 1)
        val w = (right - left).toInt().coerceIn(1, frame.width - x)
        val h = (bottom - top).toInt().coerceIn(1, frame.height - y)
        if (w < 6 || h < 6) return null

        val crop = Bitmap.createBitmap(frame, x, y, w, h)
        val enhanced = OcrPrep.enhance(crop)
        crop.recycle()  // enhance() has copied it into `enhanced`
        return enhanced
    }
}
