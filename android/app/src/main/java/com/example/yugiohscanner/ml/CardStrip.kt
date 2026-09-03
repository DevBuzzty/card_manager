package com.example.yugiohscanner.ml

import android.graphics.Bitmap

/**
 * The detector boxes the ARTWORK (card middle), not the whole card. Both codes we read live in a
 * thin band at the very BOTTOM of the card: the 8-digit passcode bottom-left, the set code
 * bottom-right. Measured against the artwork box, that band sits roughly 0.55..1.05 box-heights
 * BELOW the artwork's lower edge and spans the full card width.
 *
 * The old geometry (a strip ending ~0.50 box-heights below the artwork) landed on the type line /
 * top of the effect text instead — it cut the passcode off, which is why identification fell back
 * to whole-frame OCR. This one band captures passcode AND set code together, so a single OCR pass
 * per box yields both.
 */
object CardStrip {
    /** Crop the bottom code band for [b] out of the full-res [frame]; null if it lands off-frame. */
    fun bottomBand(frame: Bitmap, b: Box): Bitmap? {
        val bw = b.x2 - b.x1
        val bh = b.y2 - b.y1
        val x = (b.x1 - 0.06f * bw).toInt().coerceIn(0, frame.width - 1)
        val yTop = b.y2 + 0.55f * bh
        val y = yTop.toInt().coerceIn(0, frame.height - 1)
        val w = (bw * 1.12f).toInt().coerceIn(1, frame.width - x)
        val h = (b.y2 + 1.05f * bh - yTop).toInt().coerceIn(1, frame.height - y)
        if (w < 6 || h < 6) return null
        return Bitmap.createBitmap(frame, x, y, w, h)
    }
}
