package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Spec D2 Task 6 -- the OCR-zone measurement harness ("Messkorb"). Later tasks (8: per-zone
 * preprocessing, 10: multi-frame voting, 11: gate tuning) need a repeatable number to measure
 * themselves against; this is what produces it.
 *
 * Deliberately does NOT export crops from Python and push those -- it pushes whole card IMAGES
 * plus an explicit detector BOX per image, then runs the real production path on-device:
 * [CardZones.crop] (which itself runs [OcrPrep.enhance], the very thing Task 8 changes) and the
 * same ML Kit [TextRecognizerOptions.DEFAULT_OPTIONS] recognizer [HybridPipeline] uses. A harness
 * fed Python-made crops would be structurally blind to preprocessing changes.
 *
 * Detection itself is intentionally NOT exercised -- the box is supplied, not detected -- so this
 * measures OCR/zone quality in isolation from detector quality, which is a separate, already-
 * shipped concern. Mirrors [HybridPipeline.readZones]'s logic (artwork-shape gate, zone crop +
 * OCR, legacy-band fallback when the layout is unknown or still a STANDARD placeholder,
 * [OcrText.findPasscode] / [SetCodeOcr.extract] on the pooled text) minus the embedder-driven
 * layout lookup and the catalog gate on passcode correction -- both fed by ground truth / a fixed
 * default here, since this harness's job is zone/OCR quality, not identification or catalog
 * policy. `ml/ocr_bench.py` builds the manifest (with ground truth from `ml/ocr_bench/labels.csv`
 * plus the rig frame filenames) and scores `results.json` against it.
 *
 * Reads  <externalFilesDir>/ocr_bench/in/manifest.json + .../in/images/<file>
 * Writes <externalFilesDir>/ocr_bench/out/results.json
 */
@RunWith(AndroidJUnit4::class)
class OcrBench {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    @Test
    fun runBenchmark() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val base = File(context.getExternalFilesDir(null), "ocr_bench")
        val manifestFile = File(base, "in/manifest.json")
        val imagesDir = File(base, "in/images")
        val outDir = File(base, "out")
        outDir.mkdirs()

        val manifest = JSONObject(manifestFile.readText())
        val items = manifest.getJSONArray("items")
        android.util.Log.i("OcrBench", "manifest: ${items.length()} items")

        val results = JSONArray()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            results.put(processItem(item, imagesDir))
            if ((i + 1) % 25 == 0 || i == items.length() - 1) {
                android.util.Log.i("OcrBench", "processed ${i + 1}/${items.length()}")
            }
        }

        File(outDir, "results.json").writeText(results.toString())
        recognizer.close()
        android.util.Log.i("OcrBench", "wrote ${File(outDir, "results.json")}")
    }

    /**
     * One manifest item -> one result. Never throws -- a per-item failure (bad box, unreadable
     * file, ...) is recorded as an `error` field instead of aborting the whole run, so one rotten
     * photo doesn't cost the rest of the corpus.
     */
    private fun processItem(item: JSONObject, imagesDir: File): JSONObject {
        val out = JSONObject().put("id", item.getString("id"))
        var bitmap: Bitmap? = null
        try {
            val imageName = item.getString("image")
            val loaded = BitmapFactory.decodeFile(File(imagesDir, imageName).absolutePath)
                ?: error("decode failed for $imageName")
            bitmap = loaded

            val boxArr = item.getJSONArray("box")
            val box = Box(
                boxArr.getDouble(0).toFloat(), boxArr.getDouble(1).toFloat(),
                boxArr.getDouble(2).toFloat(), boxArr.getDouble(3).toFloat(), 1f
            )
            // manifest layout is null exactly for rig frames the embedder missed (pcNONE) --
            // mirrors HybridPipeline.readZones's "type unknown" branch.
            val catalogLayout =
                if (item.isNull("layout")) null else Layout.valueOf(item.getString("layout"))

            val bw = box.x2 - box.x1
            val bh = box.y2 - box.y1
            out.put("aspect", CardLayout.aspect(bw, bh).toDouble())

            // Same inference the live pipeline makes: with no layout from the catalog, the box's
            // own shape names one. Mirrored here deliberately -- the benchmark has to measure the
            // production path, not a simplified copy of it.
            val layout = catalogLayout ?: CardLayout.inferFromBox(bw, bh)
            out.put("inferredLayout", if (catalogLayout == null && layout != null) layout.name else JSONObject.NULL)

            if (!CardLayout.isArtworkShaped(layout, bw, bh)) {
                // Same gate HybridPipeline.readZones applies before reading any zone: an
                // implausibly-shaped box means the zones would read the wrong part of the card.
                out.put("skipped", true)
                return out
            }
            out.put("skipped", false)

            // inferFromBox already returned null for a box in no band, and the gate above rejected
            // it, so reaching here with a null layout is impossible in practice; STANDARD stays as
            // a defensive default rather than a !! that would crash the whole benchmark run.
            val effectiveLayout = layout ?: Layout.STANDARD
            val zoneTexts = LinkedHashMap<Zone, String>()
            val zonesJson = JSONObject()
            for ((zone, zoneBitmap) in CardZones.crop(loaded, box, effectiveLayout)) {
                val text = try {
                    Tasks.await(recognizer.process(InputImage.fromBitmap(zoneBitmap, 0))).text
                } finally {
                    zoneBitmap.recycle()
                }
                zoneTexts[zone] = text
                zonesJson.put(zone.name, text)
            }
            out.put("zones", zonesJson)

            // Legacy full-width band, exactly when HybridPipeline.readZones would fetch it: the
            // layout resolved to nothing (rig frames the embedder missed), or it is still a
            // STANDARD placeholder (SKILL / LEGACY -- neither appears in this corpus, but the
            // check is kept for fidelity).
            val needsLegacyBand = layout == null || layout == Layout.SKILL || layout == Layout.LEGACY
            var legacyText = ""
            if (needsLegacyBand) {
                val legacyBmp = CardZones.legacyBand(loaded, box)
                if (legacyBmp != null) {
                    legacyText = try {
                        Tasks.await(recognizer.process(InputImage.fromBitmap(legacyBmp, 0))).text
                    } finally {
                        legacyBmp.recycle()
                    }
                }
            }
            out.put("legacy", legacyText)

            // Same extraction the scanner runs, on the same pooled text -- default (always-true)
            // catalog gate, since this harness has no device catalog state to depend on and its
            // job is zone/OCR quality, not catalog policy.
            val extractedPasscode = OcrText.findPasscode(concatZoneTexts(zoneTexts, legacyText))
            out.put("extractedPasscode", extractedPasscode ?: JSONObject.NULL)
            out.put("extractedSetCodes", JSONArray(SetCodeOcr.extract(zoneTexts.values.joinToString(" "))))
        } catch (e: Exception) {
            out.put("error", e.message ?: e.toString())
        } finally {
            bitmap?.recycle()
        }
        return out
    }
}
