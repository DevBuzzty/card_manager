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
        val bb = ByteBuffer.wrap(ModelStore.bytes(context, "index.bin"))
            .order(ByteOrder.LITTLE_ENDIAN)
        n = bb.int
        dim = bb.int
        emb = FloatArray(n * dim) { bb.float }
        passcodes = IntArray(n) { bb.int }
    }

    /**
     * Wie [search], zusaetzlich die Aehnlichkeit der besten ANDEREN Karte (anderer Passcode) -- fuer die
     * Abstandsregel in [ScanPipeline.embedBox]. Liefert (passcode, cosine, cosine der Zweitbesten).
     */
    fun searchTop2(query: FloatArray): Triple<Int, Float, Float> {
        var best = -1
        var bestSim = -2f
        val sims = FloatArray(n)
        for (i in 0 until n) {
            var s = 0f
            val off = i * dim
            for (d in 0 until dim) s += emb[off + d] * query[d]
            sims[i] = s
            if (s > bestSim) { bestSim = s; best = i }
        }
        if (best < 0) return Triple(-1, bestSim, -2f)
        val pc = passcodes[best]
        var second = -2f
        for (i in 0 until n) if (passcodes[i] != pc && sims[i] > second) second = sims[i]
        return Triple(pc, bestSim, second)
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
