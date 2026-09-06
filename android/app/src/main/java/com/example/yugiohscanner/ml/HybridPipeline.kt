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

    // State for the diagnostic frame dump (off by default, see DUMP_FRAMES).
    private val appContext = context.applicationContext
    private var dumpsWritten = 0


    // A corrected passcode is only credible if that card actually exists (Spec D 7c). The offline
    // catalog from Spec D1 answers this from local SQLite, so it costs no network — and it stops an
    // aggressive confusion fix from inventing a card. Unknown-to-the-catalog cards (brand-new sets)
    // fall back to accepting the code, so the check can never be worse than no check.
    private val catalogKnows: (String) -> Boolean = { pc ->
        runCatching { CatalogRepository.card(pc) != null }.getOrDefault(true)
    }

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
            val passcode = embed?.passcode ?: (OcrText.findPasscode(concatZoneTexts(zoneTexts, legacyText), catalogKnows) ?: -1)
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
            val pc = OcrText.findPasscode(text, catalogKnows)
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

        dumpFrame(frame, b, layoutLabel)

        // The zones are anchored to the artwork box, so they are only meaningful when the detector
        // actually boxed the ARTWORK. A Yu-Gi-Oh artwork window is square (37x37 mm), and the
        // corpus the zones were measured on went through crop_artworks.py's aspect filter, so every
        // measured box was artwork-shaped. The phone's DetectorModel.detect filters on confidence
        // ONLY, and on ~17% of readings it returns something much taller — the card's upper half,
        // say. Then box.y2 sits far below the artwork's lower edge and every zone slides down with
        // it: measured on device, a box at ratio 1.015 put the SET_CODE zone exactly on the code,
        // while one at 0.877 put it on the effect text and the PASSCODE zone off the card entirely.
        // Reading a zone off an implausible box produces confident nonsense, so skip the OCR and
        // say so. Identification is unaffected — the embedder already ran on this box.
        val aspect = (b.x2 - b.x1) / (b.y2 - b.y1).coerceAtLeast(1f)
        if (aspect < ARTWORK_AR_MIN || aspect > ARTWORK_AR_MAX) {
            android.util.Log.i("BandOcr", "layout=$layoutLabel zone=SKIPPED ar=${String.format(java.util.Locale.ROOT, "%.3f", aspect)} " +
                "box=${(b.x2 - b.x1).toInt()}x${(b.y2 - b.y1).toInt()} (Box ist kein Artwork)")
            return emptyMap<Zone, String>() to ""
        }

        val zoneTexts = LinkedHashMap<Zone, String>()
        for ((zone, bitmap) in CardZones.crop(frame, b, layout ?: Layout.STANDARD)) {
            val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text
            zoneTexts[zone] = text
            // Spec D2 needs to know WHAT each zone actually saw -- until now the only raw-OCR
            // logging sat in PasscodeOcr, which the live HybridPipeline path never calls, so this
            // was invisible. One zone is one log line; newlines flattened to " | ".
            android.util.Log.i("BandOcr", "layout=$layoutLabel zone=$zone " +
                "frame=${frame.width}x${frame.height} " +
                "box=${b.x1.toInt()},${b.y1.toInt()}-${b.x2.toInt()},${b.y2.toInt()} " +
                "crop=${bitmap.width}x${bitmap.height} " +
                "raw='" + text.replace("\n", " | ") + "'")
            bitmap.recycle()  // CardZones.crop hands ownership to the caller
        }

        // Diagnostic: the raw text above is pre-correction. Log what SetCodeOcr actually makes of
        // it, so a device run can show whether the grammar pass (Task 9) helps -- otherwise the only
        // evidence is unit tests, which is not a measurement.
        val corrected = SetCodeOcr.extract(zoneTexts.values.joinToString(" "))
        if (corrected.isNotEmpty()) {
            android.util.Log.i("BandOcr", "layout=$layoutLabel korrigiert=" + corrected.joinToString(","))
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

    /** TEMPORARY (Spec D2 diagnostic): write the raw analysis frame plus its box, so the measured
     *  zones can be drawn over a REAL phone frame offline. Max [MAX_DUMPS] files, ~1 MB each. */
    private fun dumpFrame(frame: Bitmap, b: Box, layoutLabel: String) {
        if (!DUMP_FRAMES || dumpsWritten >= MAX_DUMPS) return
        try {
            val dir = appContext.getExternalFilesDir("zonedump") ?: return
            dir.mkdirs()
            val name = "f${dumpsWritten}_${layoutLabel}_box_${b.x1.toInt()}_${b.y1.toInt()}_" +
                "${b.x2.toInt()}_${b.y2.toInt()}.jpg"
            java.io.File(dir, name).outputStream().use {
                frame.compress(Bitmap.CompressFormat.JPEG, 92, it)
            }
            dumpsWritten++
            android.util.Log.i("BandOcr", "dump geschrieben: $name")
        } catch (e: Exception) {
            android.util.Log.w("BandOcr", "dump fehlgeschlagen", e)
        }
    }

    override fun close() {
        artwork.close()
        recognizer.close()
    }

    companion object {
        // Run the whole-frame fallback OCR at most once every this many frames.
        private const val FULLFRAME_EVERY = 3

        // Diagnostic frame dump, OFF by default: writes raw camera frames to external storage, so
        // it must never ship enabled. Flip to true, rebuild, scan a few cards, then
        //   adb pull /sdcard/Android/data/com.example.yugiohscanner/files/zonedump
        // and draw the zones over the real frames offline. This is what identified the band bug and
        // then the unstable-box bug — both in seconds, after hours of reasoning had gone nowhere.
        private const val DUMP_FRAMES = false
        private const val MAX_DUMPS = 8

        // Aspect band a detector box must fall in before its zones are trusted. The artwork window
        // is square, so 1.0 is the target. The bounds are provisional and deliberately logged:
        // device evidence puts a correct placement at 1.015 and a wrong one at 0.877, and the
        // observed distribution over 136 readings was 0.7:5  0.8:18  0.9:44  1.0:67  1.1:2, so this
        // band keeps roughly 82%. Tune from the SKIPPED rate rather than by feel.
        private const val ARTWORK_AR_MIN = 0.90f
        private const val ARTWORK_AR_MAX = 1.12f

        // Layouts whose CardLayout.zones() geometry is STANDARD's placeholder, not a measurement
        // (see CardLayout.kt) -- readZones also reads the legacy band for these as a safety net.
        private val PLACEHOLDER_LAYOUTS = setOf(Layout.PENDULUM, Layout.SKILL, Layout.LEGACY)
    }
}
