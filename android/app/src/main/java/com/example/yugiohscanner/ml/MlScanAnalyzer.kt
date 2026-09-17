package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy

/**
 * Runs the ScanPipeline on live camera frames. Converts each ImageProxy to an upright
 * bitmap (rotating by the reported sensor rotation), runs recognition, and reports the
 * detections plus the upright frame size (for overlay coordinate mapping).
 * ImageAnalysis STRATEGY_KEEP_ONLY_LATEST throttles this naturally to pipeline speed.
 *
 * [diff] (last onResult param) is the grobe Bildaenderung gegenueber dem Vorbild -- siehe
 * ScanScreen's StackMotion-Verdrahtung fuer den Modus "stapel"
 * (docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/brief.md).
 */
class MlScanAnalyzer(
    private val pipeline: CardPipeline,
    private val onResult: (dets: List<Detection>, frame: Bitmap, frameW: Int, frameH: Int, ms: Long, diff: Double) -> Unit
) : ImageAnalysis.Analyzer {

    private var prevLum: IntArray? = null

    override fun analyze(image: ImageProxy) {
        try {
            val raw = image.toBitmap()
            val rot = image.imageInfo.rotationDegrees
            val upright = if (rot == 0) raw else {
                val m = Matrix().apply { postRotate(rot.toFloat()) }
                // The rotated copy supersedes `raw`; free it now (only allocated when rot != 0).
                Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also { raw.recycle() }
            }
            // MESSUNG (vorlaeufig, Stapel-Scan): grobe Bildaenderung gegenueber dem vorigen Bild.
            val small = Bitmap.createScaledBitmap(upright, 32, 32, true)
            val px = IntArray(32 * 32)
            small.getPixels(px, 0, 32, 0, 0, 32, 32)
            small.recycle()
            val lum = IntArray(px.size) { val c = px[it]; ((c shr 16 and 255) * 3 + (c shr 8 and 255) * 6 + (c and 255)) / 10 }
            val prev = prevLum
            val diff = if (prev == null) -1.0 else lum.indices.sumOf { kotlin.math.abs(lum[it] - prev[it]) }.toDouble() / lum.size
            prevLum = lum
            val t0 = System.currentTimeMillis()
            val dets = pipeline.process(upright)
            // Zweiter Messdurchgang (Stapel-Scan-Bewegung): nur Bilder mit nennenswerter Aenderung
            // loggen, statt jedes Bild -- Meldung/Verwerfung selbst loggt ScanScreen (dort ist die
            // StackMotion-Entscheidung bekannt).
            if (diff >= 4.0) {
                Log.i("StapelScan", "t=${System.currentTimeMillis()} diff=${"%.1f".format(diff)} pcs=${dets.map { it.passcode }}")
            }
            onResult(dets, upright, upright.width, upright.height, System.currentTimeMillis() - t0, diff)
        } catch (e: Throwable) {
            Log.e("MlScan", "frame failed", e)
        } finally {
            image.close()
        }
    }
}
