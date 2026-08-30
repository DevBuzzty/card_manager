package com.example.yugiohscanner.ml

import android.content.Context
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Loads index.bin (little-endian: uint32 n, uint32 dim, n*dim float32 embeddings,
 * n int32 passcodes) and does brute-force cosine nearest-neighbour search.
 */
class IndexSearcher(context: Context) {
    private val n: Int
    private val dim: Int
    private val emb: FloatArray
    private val passcodes: IntArray

    init {
        val bb = ByteBuffer.wrap(context.assets.open("index.bin").readBytes())
            .order(ByteOrder.LITTLE_ENDIAN)
        n = bb.int
        dim = bb.int
        emb = FloatArray(n * dim) { bb.float }
        passcodes = IntArray(n) { bb.int }
    }

    /** query must be L2-normalised (the embedder output is). Returns (passcode, cosine). */
    fun search(query: FloatArray): Pair<Int, Float> {
        var best = -1
        var bestSim = -2f
        for (i in 0 until n) {
            var s = 0f
            val off = i * dim
            for (d in 0 until dim) s += emb[off + d] * query[d]
            if (s > bestSim) { bestSim = s; best = i }
        }
        return Pair(if (best >= 0) passcodes[best] else -1, bestSim)
    }
}
