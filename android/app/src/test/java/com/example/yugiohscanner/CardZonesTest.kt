package com.example.yugiohscanner

import android.graphics.RectF
import com.example.yugiohscanner.ml.Box
import com.example.yugiohscanner.ml.CardZones
import com.example.yugiohscanner.ml.Zone
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [CardZones.zoneRect] is the pure box-relative-rect -> frame-pixel arithmetic that Fix round 1
 * extracted out of [CardZones]'s private `cropZone` after review found the coordinate math --
 * the one thing the original brief flagged as "must not be wrong, and no test would catch it" --
 * resting on a single manual review. `RectF` field reads (`left`/`top`/`right`/`bottom`) work
 * fine under this module's JVM unit-test stub jar; only the 4-arg constructor and `.equals()` are
 * broken there (confirmed by [CardLayoutTest]'s spike), so `rect(...)` below builds via the
 * no-arg constructor plus direct field assignment, exactly like [CardLayout]'s own `rect` helper
 * -- and the rects here are the real STANDARD SET_CODE / PASSCODE constants from [CardLayout], so
 * this test is decoupled from CardLayout's zone-lookup machinery and exercises only the math.
 */
class CardZonesTest {

    // STANDARD SET_CODE / PASSCODE, copied from CardLayout.standardZones() -- see its file for
    // provenance (measured 2026-09-06 over 954 labelled photos).
    private val setCode = rect(0.7285f, -0.0725f, 1.0536f, 0.0909f)
    private val passcode = rect(-0.1651f, 0.327f, 0.1507f, 0.5724f)

    private fun rect(left: Float, top: Float, right: Float, bottom: Float) = RectF().apply {
        this.left = left; this.top = top; this.right = right; this.bottom = bottom
    }

    private fun box(x1: Float, y1: Float, x2: Float, y2: Float) = Box(x1, y1, x2, y2, 0.9f)

    @Test fun `reviewer's worked example -- SET_CODE on box(100,200,700,800), frame 1000x1000`() {
        val result = CardZones.zoneRect(box(100f, 200f, 700f, 800f), setCode, 1000, 1000)
        // Pinned: x=537, y=756, w=195, h=98 -- straddles box.y2=800 and sits to the right, exactly
        // where the set code prints. This is the regression guard for the sign/origin bug this
        // whole plan exists to fix.
        assertArrayEquals(intArrayOf(537, 756, 195, 98), result)
    }

    @Test fun `PASSCODE, same box, computed the same way`() {
        // Same box as the SET_CODE example; a taller frame so the (lower, taller) PASSCODE zone
        // isn't itself clipped by the frame bottom -- that clamping case is covered separately
        // below. Worked by hand: bw=bh=600, left=100+(-0.1651*600)=0.94, top=800+(0.327*600)=996.2,
        // right=100+(0.1507*600)=190.42, bottom=800+(0.5724*600)=1143.44 ->
        // x=0 (0.94 truncates to 0), y=996, w=(190-0)=190, h=(1143-996)=147.
        //
        // w is 190, not the 189 this test asserted before the final review: the width runs from
        // the CLAMPED origin to the zone's right edge. Measuring (right - left) from the unclamped
        // left made the crop overshoot the zone by |left| px -- barely here (0.94), badly when the
        // card sits at the frame edge, see the next test.
        val result = CardZones.zoneRect(box(100f, 200f, 700f, 800f), passcode, 1000, 1200)
        assertArrayEquals(intArrayOf(0, 996, 190, 147), result)
    }

    @Test fun `negative left clamps to 0 and width shrinks to the frame edge instead of wrapping`() {
        // Box near the left frame edge: box.x1 + rect.left*bw = 10 + (-0.1651*600) = -89.06,
        // solidly negative. right = 10 + (0.1507*600) = 100.42.
        val result = CardZones.zoneRect(box(10f, 200f, 610f, 800f), passcode, 150, 1200)
        // x clamps to 0 (not a wraparound negative index), and the width is the VISIBLE part of
        // the zone: right(100) - x(0) = 100. The old code computed (right - left) = 189 and then
        // let the frame clamp trim it to 150 -- which looked like a clamp doing its job but was
        // really the crop running 89 px past the zone's own right edge, straight into the
        // copyright and edition text beside the passcode. The frame clamp only hid it.
        assertArrayEquals(intArrayOf(0, 996, 100, 147), result)
    }

    @Test fun `contrastFor gives SET_CODE the measured 1_0 pivot, everything else the old 1_5 default`() {
        // Task 8 (Spec D2): measured on-device against ml_ocr_bench.py's 445-image corpus -- see
        // CardZones.contrastFor's doc for the full before/after table. 1.0 (no contrast boost at
        // all) beat every other value tried (2.2, 1.5, 1.15, 0.7) on SET_CODE specifically; nothing
        // else in this comparison touched PASSCODE, so it must keep enhance()'s original default.
        assertEquals(1.0f, CardZones.contrastFor(Zone.SET_CODE), 0f)
        assertEquals(1.5f, CardZones.contrastFor(Zone.PASSCODE), 0f)
        assertEquals(1.5f, CardZones.contrastFor(Zone.EDITION), 0f)
    }

    @Test fun `zone below the frame bottom degenerates below 6px and returns null`() {
        // Same box and SET_CODE zone as the worked example, but the frame is only 760px tall --
        // shorter than the box's own y2=800. The zone's top (756) still just barely lands inside
        // the frame, but only 4px of it (760-756) remain below that before the frame ends, which
        // is under the 6px floor, so the whole zone is off-frame in every way that matters.
        val result = CardZones.zoneRect(box(100f, 200f, 700f, 800f), setCode, 1000, 760)
        assertNull(result)
    }
}
