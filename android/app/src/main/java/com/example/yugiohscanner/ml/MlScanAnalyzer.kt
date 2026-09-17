package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs the ScanPipeline on live camera frames. Converts each ImageProxy to an upright
 * bitmap (rotating by the reported sensor rotation), runs recognition, and reports the
 * detections plus the upright frame size (for overlay coordinate mapping).
 *
 * Stapel-Lichtschranke (docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/brief.md): die
 * Erkennung laeuft auf einem eigenen Einzel-Thread und nur, wenn sie frei ist; [analyze] selbst
 * kehrt sofort zurueck und misst auf JEDEM Kamerabild die Bewegung in Lichtschranke und
 * Umrandung (sobald [setGuide] sie kennt). Aufrufer muessen nach dem Entbinden der Kamera
 * [shutdown] aufrufen, BEVOR sie die Pipeline schliessen.
 *
 * [diff] (last onResult param) is the grobe Bildaenderung gegenueber dem Vorbild -- siehe
 * ScanScreen's StackMotion-Verdrahtung fuer den Modus "stapel"
 * (docs/superpowers/ledgers/2026-09-17-stapel-scan-bewegung/brief.md).
 */
class MlScanAnalyzer(
    private val pipeline: CardPipeline,
    private val onResult: (dets: List<Detection>, frame: Bitmap, frameW: Int, frameH: Int, ms: Long, diff: Double) -> Unit
) : ImageAnalysis.Analyzer {

    // Nur auf mlExecutor benutzt.
    private var prevLum: IntArray? = null

    private val mlExecutor = Executors.newSingleThreadExecutor()
    private val mlBusy = AtomicBoolean(false)

    /** Umrandung in View-Pixeln + View-Groesse (l, t, r, b, viewW, viewH); null = unbekannt. */
    @Volatile private var guideView: FloatArray? = null

    // Nur auf dem Analyse-Thread benutzt.
    private var prevStrip: FloatArray? = null
    private var prevInner: FloatArray? = null

    fun setGuide(l: Float, t: Float, r: Float, b: Float, viewW: Float, viewH: Float) {
        guideView = floatArrayOf(l, t, r, b, viewW, viewH)
    }

    override fun analyze(image: ImageProxy) {
        val tFrame = System.currentTimeMillis()
        try {
            val rot = image.imageInfo.rotationDegrees
            val gv = guideView
            var uprightGuide: GuideRegion.NRect? = null
            var strip = -1.0
            var inner = -1.0
            if (gv != null) {
                val uw = if (rot % 180 == 0) image.width else image.height
                val uh = if (rot % 180 == 0) image.height else image.width
                val g = GuideRegion.viewToUpright(gv[0], gv[1], gv[2], gv[3], gv[4], gv[5], uw, uh)
                uprightGuide = g
                val plane = image.planes[0]
                val s = zoneMeans(plane.buffer, plane.rowStride, plane.pixelStride, image.width, image.height,
                    GuideRegion.uprightToSensor(GuideRegion.strip(g), rot), 8)
                val i = zoneMeans(plane.buffer, plane.rowStride, plane.pixelStride, image.width, image.height,
                    GuideRegion.uprightToSensor(g, rot), 16)
                strip = meanAbsDiff(prevStrip, s)
                inner = meanAbsDiff(prevInner, i)
                prevStrip = s
                prevInner = i
            }

            val startMl = mlBusy.compareAndSet(false, true)
            if (gv != null) {
                MessLog.line("StapelMess", "t=$tFrame strip=${"%.1f".format(strip)} inner=${"%.1f".format(inner)} ml=${if (startMl) "start" else "busy"}")
            }
            if (!startMl) return

            val raw = try { image.toBitmap() } catch (e: Throwable) { mlBusy.set(false); throw e }
            try {
                mlExecutor.execute { runMl(raw, rot, tFrame, uprightGuide) }
            } catch (e: Throwable) {
                raw.recycle()
                mlBusy.set(false)
                throw e
            }
        } catch (e: Throwable) {
            Log.e("MlScan", "frame failed", e)
        } finally {
            image.close()
        }
    }

    private fun runMl(raw: Bitmap, rot: Int, tFrame: Long, uprightGuide: GuideRegion.NRect?) {
        try {
            val upright = if (rot == 0) raw else {
                val m = Matrix().apply { postRotate(rot.toFloat()) }
                // The rotated copy supersedes `raw`; free it now (only allocated when rot != 0).
                Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also { raw.recycle() }
            }
            // Grobe Bildaenderung gegenueber dem vorigen ERKENNUNGS-Bild (StackMotion, Stapel-Scan v1).
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
            if (diff >= 4.0) {
                MessLog.line("StapelScan", "t=${System.currentTimeMillis()} diff=${"%.1f".format(diff)} pcs=${dets.map { it.passcode }}")
            }
            if (uprightGuide != null) {
                val pcs = dets.joinToString(",") { d ->
                    val cx = (d.box.x1 + d.box.x2) / 2f / upright.width
                    val cy = (d.box.y1 + d.box.y2) / 2f / upright.height
                    "${d.passcode}:${if (uprightGuide.contains(cx, cy)) "in" else "aus"}"
                }
                MessLog.line("StapelMess", "ml t=$tFrame fertig=${System.currentTimeMillis()} pcs=[$pcs]")
            }
            onResult(dets, upright, upright.width, upright.height, System.currentTimeMillis() - t0, diff)
        } catch (e: Throwable) {
            Log.e("MlScan", "frame failed", e)
        } finally {
            mlBusy.set(false)
        }
    }

    /** Laufende Erkennung abwarten und den Erkennungs-Thread beenden. */
    fun shutdown() {
        mlExecutor.shutdown()
        try {
            mlExecutor.awaitTermination(2, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    /** Blockmittel der Luma in [zone] (Sensor-normiert), [grid]x[grid] Bloecke, jedes 4. Pixel. */
    private fun zoneMeans(buf: ByteBuffer, rowStride: Int, pxStride: Int, w: Int, h: Int, zone: GuideRegion.NRect, grid: Int): FloatArray {
        val x0 = (zone.l * w).toInt().coerceIn(0, w)
        val x1 = (zone.r * w).toInt().coerceIn(0, w)
        val y0 = (zone.t * h).toInt().coerceIn(0, h)
        val y1 = (zone.b * h).toInt().coerceIn(0, h)
        val bw = maxOf(1, (x1 - x0) / grid)
        val bh = maxOf(1, (y1 - y0) / grid)
        val out = FloatArray(grid * grid)
        for (gy in 0 until grid) {
            val yEnd = minOf(y0 + (gy + 1) * bh, h)
            for (gx in 0 until grid) {
                val xEnd = minOf(x0 + (gx + 1) * bw, w)
                var sum = 0L
                var n = 0
                var y = y0 + gy * bh
                while (y < yEnd) {
                    val row = y * rowStride
                    var x = x0 + gx * bw
                    while (x < xEnd) {
                        sum += buf.get(row + x * pxStride).toInt() and 0xFF
                        n++
                        x += 4
                    }
                    y += 4
                }
                out[gy * grid + gx] = if (n > 0) sum.toFloat() / n else 0f
            }
        }
        return out
    }

    private fun meanAbsDiff(prev: FloatArray?, cur: FloatArray): Double {
        if (prev == null || prev.size != cur.size) return -1.0
        var s = 0.0
        for (k in cur.indices) s += kotlin.math.abs(cur[k] - prev[k])
        return s / cur.size
    }
}
