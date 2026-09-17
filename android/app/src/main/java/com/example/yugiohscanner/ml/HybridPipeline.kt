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
    // aggressive confusion fix from inventing a card.
    //
    // The isReady() guard is load-bearing, not decoration. runCatching{}.getOrDefault(true) only
    // substitutes on a THROWN exception; a catalog that simply has no such row returns null and the
    // check would REJECT. On a device whose catalog has not been imported yet that rejects every
    // corrected passcode — and the correction path only runs when the embedder missed, i.e. foils
    // and angles, exactly the cases this plan exists to rescue. Without this guard the gate is
    // strictly worse than no gate.
    //
    // Beide Aufrufe stehen INNERHALB des runCatching, nicht nur card(). isReady() geht über
    // version() ebenfalls direkt an SQLite (CatalogRepository.version -> CatalogDb.version ->
    // readableDatabase.query), wirft also bei beschädigter oder nicht lesbarer catalog.db —
    // StartScreen umschliesst denselben Aufruf aus genau diesem Grund. Stuende isReady() draussen,
    // liefe die Ausnahme bis zum Sammel-catch in MlScanAnalyzer.analyze() durch und verwuerfe dort
    // den GANZEN Frame samt aller Boxen, Bild fuer Bild, solange die Datei kaputt bleibt — wieder
    // dieselbe Klasse Fehler, nur mit anderem Ausloeser.
    private val catalogKnows: (String) -> Boolean = { pc ->
        runCatching { !CatalogRepository.isReady() || CatalogRepository.card(pc) != null }
            .getOrDefault(true)
    }

    override fun process(frame: Bitmap): List<Detection> = process(frame, null)

    override fun process(frame: Bitmap, guide: GuideRegion.NRect?): List<Detection> {
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
        // Umrandungs-Suche (Befund 17.09.: der Detektor findet Artworks IM Kartenrahmen kaum, der
        // Embedder erkennt sie ausgeschnitten sicher): findet der Detektor in der Umrandung nichts,
        // das Artwork an seiner erwarteten Stelle ausschneiden und die besten von wenigen leicht
        // verschobenen Ausschnitten nehmen -- mit strengerer Schwelle, leerer Karton kam auf 0,62.
        if (guide != null && out.none { guide.contains((it.box.x1 + it.box.x2) / 2f / frame.width, (it.box.y1 + it.box.y2) / 2f / frame.height) }) {
            val t0 = System.currentTimeMillis()
            val hits = GuideRegion.artworkCandidates(guide, frame.width, frame.height)
                .map { artwork.embedBox(frame, it, 0f) }
            val best = hits.filterNotNull().filter { it.sim >= GUIDE_MIN_SIM }.maxByOrNull { it.sim }
            android.util.Log.i("GuideArt", "umrandung ${best?.passcode ?: "-"} in ${System.currentTimeMillis() - t0}ms " +
                "kandidaten=${hits.joinToString(" ") { "${it?.passcode}@${"%.2f".format(it?.sim ?: 0f)}" }} guide=$guide")
            if (best != null && out.none { it.passcode == best.passcode }) {
                val (zoneTexts, legacyText) = readZones(frame, best.box, best.passcode)
                out.add(Detection(best.box, best.passcode, best.sim, zoneTexts, legacyText))
                return out
            }
        }
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
     *  - [knownPasscode] null (embedder missed): type is unknown, so the layout is inferred from
     *    the box's own shape ([CardLayout.inferFromBox]) -- a ~1.33-wide box can only be PENDULUM,
     *    a square one is read as STANDARD -- plus the legacy full-width band as the honest second
     *    source, because an inference from one number is still a guess. A box matching no band
     *    yields no layout and the zone OCR is skipped entirely.
     * [Layout.SKILL] and [Layout.LEGACY] also get the legacy band even when the type IS known,
     * because their zone geometry is still [CardLayout]'s explicit STANDARD placeholder rather
     * than a measurement. PENDULUM no longer needs it -- its zones were measured 2026-09-07.
     *
     * Every zone bitmap [CardZones] hands back is already enhanced; this function OCRs each and
     * recycles it immediately after, exactly as the old single-band read did.
     */
    private fun readZones(frame: Bitmap, b: Box, knownPasscode: Int?): Pair<Map<Zone, String>, String> {
        // Key the safety net off whether the TYPE actually resolved, not off whether `layout` is
        // null: CardLayout.layoutFor(null) returns STANDARD, a concrete value, so keying off the
        // layout silently denied the legacy band to catalog misses — the case where we know least.
        // The artwork index and the catalog are separately versioned artefacts (Spec D1 ships both),
        // so a freshly trained index really can identify a card the catalog does not carry yet;
        // that card would otherwise get STANDARD geometry with no fallback at all, strictly worse
        // than the embedder-miss path it sits beside.
        val type = knownPasscode?.let {
            runCatching { CatalogRepository.card(it.toString())?.type }.getOrNull()
        }
        val bw = b.x2 - b.x1
        val bh = b.y2 - b.y1
        val catalogLayout = if (type != null) CardLayout.layoutFor(type) else null
        // When the catalog cannot name the layout, the box's own shape can (see
        // CardLayout.inferFromBox). Without this, an embedder miss got STANDARD's square band and
        // any Pendulum card among them was discarded -- 21 of the 85 embedder-miss frames in the
        // benchmark corpus, clustered at aspect 1.3, and those are the foils and steep angles this
        // whole path exists to rescue.
        val layout = catalogLayout ?: CardLayout.inferFromBox(bw, bh)
        // Keyed off the CATALOG layout, not the resolved one: an inferred layout is a guess from
        // one number, so it keeps the legacy band as its second source just like no layout at all.
        val needsLegacyBand = catalogLayout == null || catalogLayout in PLACEHOLDER_LAYOUTS
        // "_INF" marks an inferred layout, and it is deliberately not "?": this label goes into
        // the dump FILENAME (see dumpFrame), a "?" is an illegal filename character on Windows so
        // `adb pull` fails on it, and ocr_bench.py's RIG_RE matches ([A-Z_]+) and would silently
        // drop such a frame from the corpus. The existing rig frames predate inferFromBox, so this
        // has not bitten yet -- the next dump session would have been the first.
        val layoutLabel = catalogLayout?.toString() ?: layout?.let { "${it}_INF" } ?: "UNKNOWN"

        dumpFrame(frame, b, layoutLabel, knownPasscode)

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
        //
        // Mit einem ABGELEITETEN Layout kann diese Pruefung nicht mehr scheitern: inferFromBox
        // liefert nur ein Layout, in dessen Band die Box ohnehin liegt. Sie sichert weiterhin den
        // ueber den Katalog aufgeloesten Pfad ab (eine bekannte STANDARD-Karte, deren Box die
        // obere Kartenhaelfte erwischt hat), und sie ist es, die eine Box verwirft, die in gar kein
        // Band faellt — 55 der 85 Embedder-Fehltreffer im Messkorb, gestreut von 1:0.3 bis 8.6.
        if (!CardLayout.isArtworkShaped(layout, bw, bh)) {
            android.util.Log.i("BandOcr", "layout=$layoutLabel zone=SKIPPED " +
                "ar=${String.format(java.util.Locale.ROOT, "%.3f", CardLayout.aspect(bw, bh))} " +
                "box=${bw.toInt()}x${bh.toInt()} (Box ist kein Artwork)")
            return emptyMap<Zone, String>() to ""
        }

        val zoneTexts = LinkedHashMap<Zone, String>()
        for ((zone, bitmap) in CardZones.crop(frame, b, layout ?: Layout.STANDARD)) {
            // A placeholder layout has no measured SET_CODE geometry — CardLayout.zones() hands it
            // STANDARD's rectangle, which for a Skill or pre-2004 frame points at whatever happens
            // to sit there. Recording it anyway would be worse than useless: SetCodeEvidence ranks
            // Zone.SET_CODE ABOVE the legacy full-width band, and a single grammar-valid token
            // scraped out of artwork would then outrank the honest band read that needsLegacyBand
            // exists to provide. So drop it, and let the band speak for these layouts.
            //
            // Only SET_CODE. PASSCODE keeps its placeholder read: it is pooled into
            // OcrText.findPasscode, which validates against the catalog, so a nonsense read there
            // is discarded rather than promoted.
            if (zone == Zone.SET_CODE && catalogLayout in PLACEHOLDER_LAYOUTS) {
                bitmap.recycle()
                continue
            }
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
     *  zones can be drawn over a REAL phone frame offline, and so Task 6 can build its benchmark
     *  from frames the analyzer actually saw rather than from camera photos.
     *
     *  Only every [DUMP_EVERY]th frame is written. Without that the analyzer fills [MAX_DUMPS] in
     *  the first second or two on a single card, and a benchmark set of twenty different cards
     *  needs the budget spread across all of them.
     *
     *  [passcode] goes in the name so frames can be grouped back to their card offline without
     *  relying on scan order. It is null exactly when the embedder missed — foils and steep angles,
     *  which is the half of the set that has to be matched up by hand anyway. */
    private fun dumpFrame(frame: Bitmap, b: Box, layoutLabel: String, passcode: Int?) {
        if (!DUMP_FRAMES || dumpsWritten >= MAX_DUMPS) return
        if (frameCount % DUMP_EVERY != 0) return
        try {
            val dir = appContext.getExternalFilesDir("zonedump") ?: return
            dir.mkdirs()
            val name = "f${dumpsWritten}_pc${passcode ?: "NONE"}_${layoutLabel}_box_" +
                "${b.x1.toInt()}_${b.y1.toInt()}_${b.x2.toInt()}_${b.y2.toInt()}.jpg"
            java.io.File(dir, name).outputStream().use {
                frame.compress(Bitmap.CompressFormat.JPEG, 92, it)
            }
            dumpsWritten++
            android.util.Log.i("BandOcr", "dump $dumpsWritten/$MAX_DUMPS geschrieben: $name")
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

        // Mindest-Aehnlichkeit fuer die Umrandungs-Suche. Karten auf den Diagnosefotos: >= 0,73 schon im
        // mittleren Ausschnitt, bester >= 0,80; blosser Karton: bis 0,62.
        private const val GUIDE_MIN_SIM = 0.70f

        // Diagnostic frame dump, OFF by default: writes raw camera frames to external storage, so
        // it must never ship enabled. Flip to true, rebuild, scan a few cards, then
        //   adb pull /sdcard/Android/data/com.example.yugiohscanner/files/zonedump
        // and draw the zones over the real frames offline. This is what identified the band bug and
        // then the unstable-box bug — both in seconds, after hours of reasoning had gone nowhere.
        private const val DUMP_FRAMES = false
        private const val MAX_DUMPS = 120
        private const val DUMP_EVERY = 4

        // Layouts whose CardLayout.zones() geometry is STANDARD's placeholder, not a measurement
        // (see CardLayout.kt) -- readZones also reads the legacy band for these as a safety net.
        // PENDULUM left this set on 2026-09-07 when its zones were measured from 65 photographs.
        private val PLACEHOLDER_LAYOUTS = setOf(Layout.SKILL, Layout.LEGACY)
    }
}
