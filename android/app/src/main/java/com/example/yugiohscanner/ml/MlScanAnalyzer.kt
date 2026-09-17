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
 * Ist die Umrandung bekannt, meldet [onResult] nur Karten, deren Box-Mitte in ihr liegt, und
 * reicht die seit dem letzten Ergebnis erkannten Einwuerfe ([ChuteGate]) mit: [einwuerfe] Anzahl,
 * [einwurfStartMs] Beginn des fruehesten. Ein Einwurf wird erst an ein Ergebnis gehaengt, dessen
 * Kamerabild NACH der Einwurf-Entscheidung aufgenommen wurde -- die Karte liegt dann schon.
 */
class MlScanAnalyzer(
    private val pipeline: CardPipeline,
    private val onResult: (dets: List<Detection>, frame: Bitmap, frameW: Int, frameH: Int, ms: Long, einwuerfe: Int, einwurfStartMs: Long) -> Unit
) : ImageAnalysis.Analyzer {

    private val mlExecutor = Executors.newSingleThreadExecutor()
    private val mlBusy = AtomicBoolean(false)

    /** Umrandung in View-Pixeln + View-Groesse (l, t, r, b, viewW, viewH); null = unbekannt. */
    @Volatile private var guideView: FloatArray? = null

    // Nur auf dem Analyse-Thread benutzt.
    private var prevStrip: FloatArray? = null
    private val chuteGate = ChuteGate()

    // Einwuerfe, die noch keinem Erkennungsergebnis mitgegeben wurden (Analyse- -> Erkennungs-Thread).
    private val einwurfLock = Any()
    private var einwurfAnzahl = 0
    private var einwurfStart = 0L
    private var einwurfEntschieden = 0L

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
            if (gv != null) {
                val uw = if (rot % 180 == 0) image.width else image.height
                val uh = if (rot % 180 == 0) image.height else image.width
                val g = GuideRegion.viewToUpright(gv[0], gv[1], gv[2], gv[3], gv[4], gv[5], uw, uh)
                uprightGuide = g
                val plane = image.planes[0]
                val s = zoneMeans(plane.buffer, plane.rowStride, plane.pixelStride, image.width, image.height,
                    GuideRegion.uprightToSensor(GuideRegion.strip(g), rot), 8)
                strip = meanAbsDiff(prevStrip, s)
                prevStrip = s
                chuteGate.update(strip, tFrame)?.let { b ->
                    Log.i("StapelScan", "stoss start=${b.startMs} dauer=${b.dauerMs} spitze=${"%.1f".format(b.peak)} einwurf=${b.einwurf}")
                    if (b.einwurf) synchronized(einwurfLock) {
                        if (einwurfAnzahl == 0) einwurfStart = b.startMs
                        einwurfAnzahl++
                        einwurfEntschieden = tFrame
                    }
                }
            }

            if (!mlBusy.compareAndSet(false, true)) return

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
            val t0 = System.currentTimeMillis()
            val all = pipeline.process(upright, uprightGuide)
            // Echte Umrandung: nur Karten, deren Mitte in ihr liegt.
            val dets = if (uprightGuide == null) all else all.filter { d ->
                uprightGuide.contains((d.box.x1 + d.box.x2) / 2f / upright.width, (d.box.y1 + d.box.y2) / 2f / upright.height)
            }
            var einwuerfe = 0
            var start = 0L
            synchronized(einwurfLock) {
                if (einwurfAnzahl > 0 && tFrame > einwurfEntschieden) {
                    einwuerfe = einwurfAnzahl
                    start = einwurfStart
                    einwurfAnzahl = 0
                }
            }
            onResult(dets, upright, upright.width, upright.height, System.currentTimeMillis() - t0, einwuerfe, start)
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
