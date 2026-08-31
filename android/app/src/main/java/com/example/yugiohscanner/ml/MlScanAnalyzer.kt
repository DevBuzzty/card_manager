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
 */
class MlScanAnalyzer(
    private val pipeline: CardPipeline,
    private val onResult: (dets: List<Detection>, frame: Bitmap, frameW: Int, frameH: Int, ms: Long) -> Unit
) : ImageAnalysis.Analyzer {

    override fun analyze(image: ImageProxy) {
        try {
            val raw = image.toBitmap()
            val rot = image.imageInfo.rotationDegrees
            val upright = if (rot == 0) raw else {
                val m = Matrix().apply { postRotate(rot.toFloat()) }
                Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
            }
            val t0 = System.currentTimeMillis()
            val dets = pipeline.process(upright)
            onResult(dets, upright, upright.width, upright.height, System.currentTimeMillis() - t0)
        } catch (e: Throwable) {
            Log.e("MlScan", "frame failed", e)
        } finally {
            image.close()
        }
    }
}
