package com.example.yugiohscanner.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.nio.FloatBuffer

/** Runs the exported artwork embedder (img[n,3,224,224] -> emb[n,128], already L2-normalised). */
class EmbedderModel(context: Context) {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession =
        env.createSession(context.assets.open("embedder.onnx").readBytes())
    private val inputName: String = session.inputNames.iterator().next()

    /** Returns the 128-d L2-normalised embedding for a 224x224 RGB bitmap. */
    fun embed(square224: Bitmap): FloatArray {
        val data = ImagePrep.embedderInput(square224)
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), longArrayOf(1, 3, 224, 224)).use { t ->
            session.run(mapOf(inputName to t)).use { res ->
                @Suppress("UNCHECKED_CAST")
                return (res[0].value as Array<FloatArray>)[0]
            }
        }
    }

    fun close() = session.close()
}
