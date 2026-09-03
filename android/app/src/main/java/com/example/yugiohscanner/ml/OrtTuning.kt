package com.example.yugiohscanner.ml

import ai.onnxruntime.OrtSession

/**
 * Shared ONNX Runtime session tuning. The models were created with default options (single graph
 * pass, ORT's default thread pool). These settings only change SPEED, not the numeric output:
 *   - ALL_OPT graph optimizations (operator fusion, constant folding) baked in at load.
 *   - intra-op threads pinned to a few big cores (2..4) — enough for these small models without
 *     oversubscribing; the analyzer already runs on one background thread so inter-op stays 1.
 *   - sequential execution + memory-pattern reuse: less allocation churn per frame.
 */
object OrtTuning {
    private fun threads() = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)

    fun sessionOptions(): OrtSession.SessionOptions {
        return OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(threads())
            setInterOpNumThreads(1)
            setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
            setMemoryPatternOptimization(true)
        }
    }

    // NOTE: XNNPACK and NNAPI were both tested for the detector and are NOT used — the detector's
    // in-graph NMS (ultralytics nms=True) makes accelerator EPs partition the graph: NNAPI fails to
    // build it, XNNPACK gave no speedup. To benefit from them, re-export the detector without
    // in-graph NMS and run NMS in Kotlin. Until then, tuned CPU is the fastest option here.
}
