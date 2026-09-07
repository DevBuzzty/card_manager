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
        Layout.PENDULUM -> pendulumZones()
        // SKILL (0 samples) and LEGACY (pre-2004 frames, never measured) still fall back to
        // STANDARD -- a PROVISIONAL placeholder, not a measurement. Do not read it as "their
        // SET_CODE is the same as STANDARD's". Task 5 keeps `CardStrip.bottomBand`'s old full-band
        // read as a safety net for these layouts, so a wrong zone degrades to the previous
        // (working, if imprecise) behaviour instead of failing outright.
        Layout.SKILL, Layout.LEGACY -> standardZones()
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

    /**
     * Measured 2026-09-07 from 65 photographs of the user's own Pendulum cards, via
     * `ml/measure_zones_photos.py` (see `ml/zones_measured.json`). Sample counts are below the
     * 40 that Task 2 required, and that is a deliberate, disclosed call rather than an oversight:
     *
     *  - The spread says these are well determined despite the count. Per-edge std runs 0.012 to
     *    0.031, which is as tight as STANDARD's zones measured from 335 samples (0.026 to 0.046).
     *    The 40-sample floor exists to stop guessing; nothing here is guessed.
     *  - The alternative was known to be WRONG, not merely imprecise. These zones do not overlap
     *    STANDARD's placeholder AT ALL -- passcode y 0.63..0.82 against 0.33..0.57, set code
     *    y 0.58..0.73 against -0.07..0.09. The placeholder read a disjoint part of the card.
     *  - Verified by eye before adoption: drawn over a real photo (IMG_20260907_183545,
     *    "Symphonischer Krieger Rock-k-ks"), the SET_CODE rectangle lands on DIFO-DE042 and the
     *    PASSCODE rectangle on 24070330.
     *
     * Both zones sit far lower than STANDARD's because the pendulum effect box occupies the space
     * under the artwork, pushing the set code down to the ATK/DEF line at the card's LEFT edge --
     * the opposite side from STANDARD, whose set code prints bottom-right just under the artwork.
     */
    private fun pendulumZones() = mapOf(
        // n=33, std x1=0.0195 y1=0.0308 x2=0.0177 y2=0.0262
        Zone.PASSCODE to rect(-0.0873f, 0.6269f, 0.1746f, 0.815f),
        // n=17, std x1=0.0123 y1=0.0173 x2=0.0181 y2=0.0159
        Zone.SET_CODE to rect(-0.0202f, 0.5782f, 0.2765f, 0.728f),
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
    /**
     * Width / height of a detector box, guarding a zero or negative height.
     *
     * Pure and separate so it can be pinned by tests, the same reason [CardZones.zoneRect] was
     * extracted. It used to sit inline in HybridPipeline.readZones with no test at all.
     */
    fun aspect(width: Float, height: Float): Float = width / height.coerceAtLeast(1f)

    /**
     * Is a box of this shape plausibly the artwork window whose [zones] geometry we are about to
     * apply?
     *
     * The band belongs to the GEOMETRY BEING APPLIED, not to the physical card, and the Pendulum
     * case is what makes that distinction concrete. A Pendulum artwork window really is wider than
     * tall — 1.28–1.35 over 11 rig frames, 1.27–1.38 over 65 photographs, a 1.31 median across the
     * eBay corpus: three independent sources agreeing on ~1.33 — because the window stretches
     * across the pendulum scales. While [zones] handed PENDULUM the STANDARD placeholder, this
     * function therefore REJECTED every correct Pendulum box, and that was right: zone offsets are
     * expressed in box widths and heights, so applying square numbers to a 1.33-wide box reads a
     * different part of the card entirely. Skipping beats confident nonsense.
     *
     * Since PENDULUM now has measured zones, its band moved WITH them, in one change. That
     * coupling is the rule, not a coincidence: a band widened on its own would unlock exactly the
     * reads the placeholder got wrong.
     *
     * Bounds are provisional and deliberately logged. Device evidence for the square band: a
     * correct placement at 1.015, a wrong one at 0.877, and over 136 readings the distribution ran
     * 0.7:5 0.8:18 0.9:44 1.0:67 1.1:2 — it keeps roughly 82%. Tune from the SKIPPED rate, not by
     * feel.
     */
    fun isArtworkShaped(layout: Layout?, width: Float, height: Float): Boolean {
        val a = aspect(width, height)
        return if (layout == Layout.PENDULUM) a in PENDULUM_AR_MIN..PENDULUM_AR_MAX
        else a in SQUARE_AR_MIN..SQUARE_AR_MAX
    }

    /**
     * Guess the layout from the artwork box's shape alone, for when the catalog cannot say.
     *
     * The box shape is real evidence, not a coin flip: PENDULUM's artwork window stretches across
     * the pendulum scales and measures ~1.33 wide, while every other layout's window is the square
     * 37x37 mm one at ~1.0. The two bands do not touch (1.12 against 1.20), so a box lands in at
     * most one of them and there is nothing to arbitrate.
     *
     * This exists because of what the benchmark found. Of 130 frames dumped from the live analyzer,
     * 85 carried no passcode at all — the embedder missed, which is what it does on foils and steep
     * angles, precisely the cases zone OCR is meant to rescue. Of those 85, the aspect guard threw
     * away 76. Measured against the bands: 55 of those really are junk (fragments of neighbouring
     * cards, frame edges, slivers, spread from 0.3 to 8.6) and rejecting them is correct — but 21
     * sit in the Pendulum band with a hard cluster of 16 at 1.3, i.e. they are Pendulum cards whose
     * geometry has been known since the zones were measured. Discarding those was pure waste.
     *
     * Returns null when the box matches no band. That is the honest answer for the other 55, and
     * the caller must skip the OCR rather than pick a layout at random.
     *
     * A guess is not a lookup: a caller resolving the layout this way should still read the legacy
     * full-width band as a second source, exactly as it does when nothing resolves at all.
     */
    fun inferFromBox(width: Float, height: Float): Layout? {
        val a = aspect(width, height)
        return when {
            a in PENDULUM_AR_MIN..PENDULUM_AR_MAX -> Layout.PENDULUM
            a in SQUARE_AR_MIN..SQUARE_AR_MAX -> Layout.STANDARD
            else -> null
        }
    }

    // The square artwork window (37x37 mm) that every layout except PENDULUM uses.
    const val SQUARE_AR_MIN = 0.90f
    const val SQUARE_AR_MAX = 1.12f

    // PENDULUM's wider window. Observed range across all three sources is 1.27–1.38; the band adds
    // roughly the same relative headroom the square band carries.
    const val PENDULUM_AR_MIN = 1.20f
    const val PENDULUM_AR_MAX = 1.45f

    private fun rect(x1: Float, y1: Float, x2: Float, y2: Float) = RectF().apply {
        left = x1; top = y1; right = x2; bottom = y2
    }
}
