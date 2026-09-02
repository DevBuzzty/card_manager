package com.example.yugiohscanner.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import java.nio.FloatBuffer

/** A detected card box in ORIGINAL frame pixel coordinates. */
data class Box(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val score: Float)

/**
 * YOLO11-nano card detector, exported to ONNX WITH embedded NMS.
 * Pinned I/O: input 'images' [1,3,640,640] float -> output 'output0' [1,300,6]
 * = (x1,y1,x2,y2,score,cls) in imgsz(640) pixel coords.
 */
class DetectorModel(context: Context, private val imgsz: Int = 640, private val conf: Float = 0.6f) {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    // Tuned CPU EP (fp32). Accelerator EPs don't pay off for THIS detector: the in-graph NMS
    // (nms=True export) forces the graph to partition, so NNAPI fails to build it at all and
    // XNNPACK gave no speedup. int8 quantization was also a wash on the CPU EP (~same ms) for a
    // ~10% recall loss. The real lever is re-exporting WITHOUT in-graph NMS (NMS in Kotlin).
    private val session: OrtSession =
        env.createSession(context.assets.open("detector.onnx").readBytes(), OrtTuning.sessionOptions())
    private val inputName: String = session.inputNames.iterator().next()
    private var inferCount = 0

    fun detect(frame: Bitmap): List<Box> {
        // Letterbox the frame into an imgsz square with gray(114) padding, preserving aspect.
        val scale = imgsz.toFloat() / maxOf(frame.width, frame.height)
        val nw = Math.round(frame.width * scale)
        val nh = Math.round(frame.height * scale)
        val padX = (imgsz - nw) / 2f
        val padY = (imgsz - nh) / 2f
        val letter = Bitmap.createBitmap(imgsz, imgsz, Bitmap.Config.ARGB_8888)
        Canvas(letter).apply {
            drawColor(Color.rgb(114, 114, 114))
            drawBitmap(Bitmap.createScaledBitmap(frame, nw, nh, true), padX, padY, null)
        }

        val input = toRgbChw01(letter)
        val boxes = ArrayList<Box>()
        val t0 = System.nanoTime()
        OnnxTensor.createTensor(
            env, FloatBuffer.wrap(input), longArrayOf(1, 3, imgsz.toLong(), imgsz.toLong())
        ).use { t ->
            session.run(mapOf(inputName to t)).use { res ->
                @Suppress("UNCHECKED_CAST")
                val out = (res[0].value as Array<Array<FloatArray>>)[0]  // [300,6]
                for (d in out) {
                    val score = d[4]
                    if (score < conf) continue
                    val x1 = (d[0] - padX) / scale
                    val y1 = (d[1] - padY) / scale
                    val x2 = (d[2] - padX) / scale
                    val y2 = (d[3] - padY) / scale
                    boxes.add(Box(x1, y1, x2, y2, score))
                }
            }
        }
        if (++inferCount % 30 == 0) {
            android.util.Log.i("OrtPerf", "detector infer=${(System.nanoTime() - t0) / 1_000_000}ms")
        }
        return boxes
    }

    /** letterboxed RGB bitmap -> CHW float[1*3*imgsz*imgsz], /255 only (YOLO, no ImageNet norm). */
    private fun toRgbChw01(bmp: Bitmap): FloatArray {
        val n = imgsz * imgsz
        val px = IntArray(n)
        bmp.getPixels(px, 0, imgsz, 0, 0, imgsz, imgsz)
        val out = FloatArray(3 * n)
        for (i in 0 until n) {
            val p = px[i]
            out[i] = ((p shr 16) and 0xFF) / 255f
            out[n + i] = ((p shr 8) and 0xFF) / 255f
            out[2 * n + i] = (p and 0xFF) / 255f
        }
        return out
    }

    fun close() = session.close()
}
