package com.example.yugiohscanner.ml

import android.graphics.RectF

/** Card frame layout, used to pick where on the card the passcode and set-code text actually sit. */
enum class Layout { STANDARD, SPELL_TRAP, PENDULUM, LINK, SKILL, LEGACY }

/** A region of text to OCR, in the box-relative coordinates [CardLayout.zones] returns. */
enum class Zone { SET_CODE, PASSCODE, EDITION }

/**
 * Per-layout OCR zone geometry, in artwork-box units — same convention as [CardStrip]: x is
 * relative to the box's LEFT edge in box-width units (negative = left of the box, values above 1
 * reach right of the box, since the card is wider than the artwork); y is relative to the box's
 * BOTTOM edge (`y2`), growing downward, in box-height units. Note SET_CODE zones straddle y = 0 —
 * the set code prints right where the artwork's lower edge sits, not below the whole card.
 *
 * The numbers below were measured 2026-09-06 by `ml/measure_zones.py` over 954 labelled eBay
 * photos (see `ml/zones_measured.json`, committed alongside it): for each photo it OCRs the region
 * below the detected artwork box and locates the known passcode / a set-code-shaped token there,
 * then takes the 5th/95th-percentile span (+ a small margin) across all matches per layout, so
 * each zone covers the measured spread rather than just one sample's position. Each block below
 * cites `n` (sample count) and `std` (per-edge standard deviation, from `zones_measured.json`) so
 * a caller can judge how tight a given zone actually is.
 */
object CardLayout {

    /**
     * Maps a YGOPRODeck `type` string to a [Layout]. `tcgDate` (YYYY-MM-DD, as returned by
     * YGOPRODeck's `cardsets.php`) is only consulted when `type` matches none of the specific
     * frames below: cards released before the 2004 frame redesign fall back to [Layout.LEGACY]
     * as a safety net, since none of the measured zones were fit to their older frame layout.
     *
     * IMPORTANT: this checks `"Pendulum" in type`, not `type.startsWith("Pendulum")`. YGOPRODeck
     * also ships "XYZ Pendulum Effect Monster" (10 cards) and "Synchro Pendulum Effect Monster"
     * (8) — they carry the Pendulum frame (and its set-code position) without starting with the
     * word. A `startsWith` check silently filed all 18 under STANDARD; this must stay in step
     * with `ml/measure_zones.py`'s `layout_for_type`, which carries the same fix.
     */
    fun layoutFor(type: String?, tcgDate: String? = null): Layout {
        if (type != null) {
            when {
                "Pendulum" in type -> return Layout.PENDULUM
                type == "Link Monster" -> return Layout.LINK
                type == "Spell Card" || type == "Trap Card" -> return Layout.SPELL_TRAP
                type == "Skill Card" -> return Layout.SKILL
            }
        }
        val year = tcgDate?.take(4)?.toIntOrNull()
        if (year != null && year < 2004) return Layout.LEGACY
        return Layout.STANDARD
    }

    /** Zone geometry for [layout]. See the class doc for the coordinate convention and provenance. */
    fun zones(layout: Layout): Map<Zone, RectF> = when (layout) {
        Layout.STANDARD -> standardZones()
        Layout.SPELL_TRAP -> spellTrapZones()
        Layout.LINK -> linkZones()
        // PENDULUM (23 usable samples) and SKILL (0) are both below the 40-sample minimum, and
        // LEGACY (pre-2004 frames) was never measured at all -- user decision 2026-09-06 to ship
        // without them and catch up later. This is a PROVISIONAL placeholder, not a measurement of
        // these layouts: do not read it as "Pendulum's SET_CODE is the same as STANDARD's". A
        // Pendulum card's set code actually prints bottom-LEFT under the pendulum-effect box, i.e.
        // nowhere near STANDARD's bottom-right zone -- a made-up constant there would be worse than
        // this honest fallback. Task 5 additionally keeps `CardStrip.bottomBand`'s old full-band
        // read as a safety net specifically for these three layouts, so a wrong zone here degrades
        // to the previous (working, if imprecise) behaviour instead of failing outright.
        Layout.PENDULUM, Layout.SKILL, Layout.LEGACY -> standardZones()
    }

    // EDITION is intentionally omitted: it has not been measured (Task 2/3 only measured PASSCODE
    // and SET_CODE), and the one plausible derivation -- widening the PASSCODE zone to the right,
    // since the edition marker sits on the same line as the passcode on most cards -- is still a
    // guess, not a measurement. Emitting a fabricated number here would violate the "do not invent
    // values" rule this task was built under, so no Zone.EDITION entry exists in any map below.

    private fun standardZones() = mapOf(
        // n=335, std x1=0.0335 y1=0.0433 x2=0.0259 y2=0.046
        Zone.PASSCODE to rect(-0.1651f, 0.327f, 0.1507f, 0.5724f),
        // n=271, std x1=0.0153 y1=0.0228 x2=0.019 y2=0.0229
        Zone.SET_CODE to rect(0.7285f, -0.0725f, 1.0536f, 0.0909f),
    )

    private fun spellTrapZones() = mapOf(
        // n=304, std x1=0.031 y1=0.0458 x2=0.0237 y2=0.049
        Zone.PASSCODE to rect(-0.1577f, 0.3231f, 0.1513f, 0.5647f),
        // n=254, std x1=0.0157 y1=0.0226 x2=0.018 y2=0.0233
        Zone.SET_CODE to rect(0.725f, -0.0739f, 1.0467f, 0.0826f),
    )

    private fun linkZones() = mapOf(
        // n=91, std x1=0.0307 y1=0.0517 x2=0.022 y2=0.0552
        Zone.PASSCODE to rect(-0.14f, 0.3091f, 0.1591f, 0.5418f),
        // n=73, std x1=0.0177 y1=0.025 x2=0.0229 y2=0.0273
        Zone.SET_CODE to rect(0.6237f, -0.0832f, 0.9489f, 0.0793f),
    )

    // RectF's 4-float constructor is a silent no-op under the Android unit-test stub jar used by
    // `testDebugUnitTest` (fields stay 0f, no exception) -- confirmed by spiking it directly.
    // Building via the no-arg constructor plus direct field assignment (raw field access, not a
    // method call) works correctly both there and on-device, so use that instead.
    private fun rect(x1: Float, y1: Float, x2: Float, y2: Float) = RectF().apply {
        left = x1; top = y1; right = x2; bottom = y2
    }
}
