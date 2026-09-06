package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap
import com.example.yugiohscanner.cloud.CatalogRepository
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Reliable hybrid recogniser. Per detected box it runs the artwork embedder (fast, accurate on
 * flat cards) and a targeted OCR of the card's measured passcode/set-code zones (foil-proof,
 * angle-tolerant; see [readZones]); the embedder identifies flat cards, the zones' passcode
 * carries foils/angles. A whole-frame OCR runs only as a throttled fallback when the detector
 * boxes nothing (a card filling the frame). All feed the same tracker/staging downstream.
 */
class HybridPipeline(context: Context, minSim: Float = 0.6f) : CardPipeline {
    private val artwork = ScanPipeline(context, minSim)
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var frameCount = 0

    override fun process(frame: Bitmap): List<Detection> {
        frameCount++
        val out = ArrayList<Detection>()
        // One detector pass finds ALL card boxes (foils included). For each box, run the artwork
        // embedder first: a hit gives the passcode with no OCR at all, and -- via the local catalog
        // -- the card's type, which picks the right zone geometry to read (see readZones). Identity
        // itself still prefers the embedder when it matches (accurate on flat cards); on foils/
        // angles, where the embedder fails, the zones' passcode carries it instead.
        val boxes = artwork.detectBoxes(frame)
        for (b in boxes) {
            val embed = artwork.embedBox(frame, b)
            val (zoneTexts, legacyText) = readZones(frame, b, embed?.passcode)
            val passcode = embed?.passcode ?: (OcrText.findPasscode(concatZoneTexts(zoneTexts, legacyText)) ?: -1)
            val sim = embed?.sim ?: 1f
            if (passcode > 0 && out.none { it.passcode == passcode }) {
                out.add(Detection(b, passcode, sim, zoneTexts, legacyText))
            }
        }
        // Last-resort whole-frame OCR — for a card that fills the frame and slips past the detector,
        // so no box is produced. It's a speculative, expensive pass, so run it ONLY when the detector
        // found no boxes at all (when boxes existed, their targeted zone OCR already covers them
        // better) and only every FULLFRAME_EVERY-th frame — pointless to burn OCR on every frame
        // while panning over an empty table.
        if (boxes.isEmpty() && frameCount % FULLFRAME_EVERY == 0) {
            val text = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0))).text
            val pc = OcrText.findPasscode(text)
            if (pc != null && pc > 0) {
                val w = frame.width.toFloat(); val h = frame.height.toFloat()
                out.add(Detection(Box(w * 0.18f, h * 0.12f, w * 0.82f, h * 0.88f, 1f), pc, 1f, emptyMap(), text))
            }
        }
        return out
    }

    /**
     * Resolve [b]'s layout and OCR its zones (see [CardZones]). The card's type -- and so its
     * exact zone geometry -- is only known once the embedder has matched it, which is exactly the
     * thing this OCR is often needed to help with (foils/angles the embedder misses). So:
     *  - [knownPasscode] non-null (embedder hit): look its type up in the local catalog and read
     *    that [Layout]'s zones.
     *  - [knownPasscode] null (embedder missed): type is unknown. Read STANDARD's zones -- the
     *    plan's "STANDARD and PENDULUM both" would today mean reading the same placeholder
     *    rectangle twice (PENDULUM has no measured geometry, see [CardLayout.zones]) -- plus the
     *    legacy full-width band as the honest second source.
     * [Layout.PENDULUM], [Layout.SKILL] and [Layout.LEGACY] also get the legacy band even when the
     * type IS known, for the same reason: their zone geometry is [CardLayout]'s explicit STANDARD
     * placeholder, not a measurement.
     *
     * Every zone bitmap [CardZones] hands back is already enhanced; this function OCRs each and
     * recycles it immediately after, exactly as the old single-band read did.
     */
    private fun readZones(frame: Bitmap, b: Box, knownPasscode: Int?): Pair<Map<Zone, String>, String> {
        val layout = knownPasscode?.let {
            val type = runCatching { CatalogRepository.card(it.toString())?.type }.getOrNull()
            CardLayout.layoutFor(type)
        }
        val needsLegacyBand = layout == null || layout in PLACEHOLDER_LAYOUTS
        val layoutLabel = layout?.toString() ?: "UNKNOWN"

        val zoneTexts = LinkedHashMap<Zone, String>()
        for ((zone, bitmap) in CardZones.crop(frame, b, layout ?: Layout.STANDARD)) {
            val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text
            zoneTexts[zone] = text
            // Spec D2 needs to know WHAT each zone actually saw -- until now the only raw-OCR
            // logging sat in PasscodeOcr, which the live HybridPipeline path never calls, so this
            // was invisible. One zone is one log line; newlines flattened to " | ".
            android.util.Log.i("BandOcr", "layout=$layoutLabel zone=$zone crop=${bitmap.width}x${bitmap.height} " +
                "raw='" + text.replace("\n", " | ") + "'")
            bitmap.recycle()  // CardZones.crop hands ownership to the caller
        }

        var legacyText = ""
        if (needsLegacyBand) {
            val legacyBmp = CardZones.legacyBand(frame, b)
            if (legacyBmp == null) {
                android.util.Log.i("BandOcr", "layout=$layoutLabel zone=LEGACY off-frame for box " +
                    "${b.x1.toInt()},${b.y1.toInt()}-${b.x2.toInt()},${b.y2.toInt()}")
            } else {
                legacyText = Tasks.await(recognizer.process(InputImage.fromBitmap(legacyBmp, 0))).text
                android.util.Log.i("BandOcr", "layout=$layoutLabel zone=LEGACY crop=${legacyBmp.width}x${legacyBmp.height} " +
                    "raw='" + legacyText.replace("\n", " | ") + "'")
                legacyBmp.recycle()
            }
        }

        return zoneTexts to legacyText
    }

    override fun close() {
        artwork.close()
        recognizer.close()
    }

    companion object {
        // Run the whole-frame fallback OCR at most once every this many frames.
        private const val FULLFRAME_EVERY = 3

        // Layouts whose CardLayout.zones() geometry is STANDARD's placeholder, not a measurement
        // (see CardLayout.kt) -- readZones also reads the legacy band for these as a safety net.
        private val PLACEHOLDER_LAYOUTS = setOf(Layout.PENDULUM, Layout.SKILL, Layout.LEGACY)
    }
}
