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
    fun crop(frame: Bitmap, box: Box, layout: Layout, setCodePadX: Float = 0f, setCodePadY: Float = 0f): Map<Zone, Bitmap> = buildMap {
        for ((zone, rect) in CardLayout.zones(layout)) {
            // Umrandungs-Suche: die Box ist nur ungefaehr (Karten landen ~90 px unterschiedlich hoch),
            // also die SET_CODE-Zone um Anteile der Box-Breite/-Hoehe aufweiten statt den Code abzuschneiden.
            val r = if (zone == Zone.SET_CODE && (setCodePadX > 0f || setCodePadY > 0f))
                RectF(rect.left - setCodePadX, rect.top - setCodePadY, rect.right + setCodePadX, rect.bottom + setCodePadY)
            else rect
            val bitmap = cropZone(frame, box, r, contrastFor(zone)) ?: continue
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
     * measurement.
     *
     * PASSCODE followed later, after the final review pointed at LINK's numbers and predicted the
     * cause: a Link frame has a dark blue bottom border with darker text on it, and at contrast 1.5
     * the pivot t = (0.5 - 0.5*1.5)*255 = -63.75 clips everything below luminance 42.5 to pure
     * black -- measured at 41% of one LINK passcode crop, the digits included. Re-measured on the
     * rebuilt 446-image corpus:
     *
     *  | PASSCODE contrast | ebay LINK | ebay SPELL_TRAP | ebay STANDARD | ebay PENDULUM |
     *  |---|---|---|---|---|
     *  | 1.5 (inherited default) | 57.6% | 75.0% | 91.4% | 76.9% |
     *  | **1.0 (chosen)** | **72.8%** | **80.4%** | 91.4% | 76.9% |
     *
     * Nineteen more hits, no cell worse. So the measured optimum is "no contrast boost at all" for
     * BOTH zones, and the 1.5 every zone inherited was simply wrong for this material: the fixed
     * curve pushes mid-tones toward flat black and white along with the text, adding noise instead
     * of removing it -- on SET_CODE because its crop straddles the artwork's lower edge and carries
     * real card art, on PASSCODE because dark card borders sit below the clipping point.
     *
     * The per-zone hook stays even though both values now agree: it carries the evidence, and the
     * two zones were measured separately and could diverge again.
     */
    internal fun contrastFor(zone: Zone): Float = when (zone) {
        Zone.SET_CODE -> 1.0f
        else -> 1.0f
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
        // Width and height are measured from the CLAMPED origin to the zone's right/bottom edge,
        // not from the unclamped one. Taking (right - left) while x has been clamped up to 0 makes
        // the crop reach |left| pixels PAST the zone's right edge -- for a PASSCODE zone, whose
        // left edge sits at -0.1651 box widths, that happens whenever the card is near the frame's
        // left edge, which is routine when scanning a laid-out row. The crop then pulls the
        // neighbouring copyright/edition text into the passcode read. Inherited from CardStrip;
        // the old tests pinned the wrong numbers rather than catching it.
        val w = (right.toInt() - x).coerceIn(1, frameW - x)
        val h = (bottom.toInt() - y).coerceIn(1, frameH - y)
        if (w < 6 || h < 6) return null

        return intArrayOf(x, y, w, h)
    }
}
