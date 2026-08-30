# Scanner Phase 4 — On-Device Android Assembly Implementation Plan

> **For agentic workers:** This plan is MIXED-VERIFICATION. Task 1 is Python and pytest-verifiable (subagent-executable). Tasks 2–5 are Android/Kotlin and can NOT be built or run in this environment — each ends with a **MANUAL on-device verification** the human performs in Android Studio on a physical device, then reports results back. Do not claim a Kotlin task "passes" from code inspection alone. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Run the Phase-2 embedder and Phase-3 detector on-device in the Android app: live camera → detect cards → crop → embed → nearest-neighbour index lookup (passcode) → multi-frame tracking → set-code OCR (rarity) → batch emit. Uses the current placeholder models (1000-card index); production models swap in later with no code change.

**Architecture:** ONNX Runtime Android runs the exported ONNX models directly (no TFLite conversion). A small Python step packages the assets (detector re-exported with embedded NMS, embedding index → compact binary). Kotlin inference wrappers (`DetectorModel`, `EmbedderModel`, `IndexSearcher`) are orchestrated by a per-frame pipeline that replaces the OCR-only `CardAnalyzer`, with a Compose overlay and batched socket emit.

**Tech Stack:** Python `ml/` (ultralytics/onnx export), ONNX Runtime Android (`com.microsoft.onnxruntime:onnxruntime-android`), existing CameraX + ML Kit + Socket.io. Kotlin/Compose, minSdk 26.

## Global Constraints

- Model assets live in `android/app/src/main/assets/` (`embedder.onnx`, `detector.onnx`, `index.bin`). Committing them is acceptable at placeholder size (~4 + ~10 + <1 MB); mark for cloud-download replacement in production. Do NOT commit the Python-side `ml/data/` artifacts.
- **Embedder preprocessing contract (MUST match Python `dataset.to_model_tensor` + `compose_scene.pad_to_square` exactly):** take the card crop → pad to a SQUARE canvas filled gray RGB(127,127,127), card centered → resize to 224×224 → per pixel in **RGB** order: `v/255`, then `(v-mean)/std` with `mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]` → layout **CHW** float32 `[1,3,224,224]`. Android bitmaps are already RGB (no BGR swap — Python swapped because OpenCV loads BGR; the net input is RGB either way). Input tensor name `"img"`, output `"emb"` (128-d, already L2-normalised by the model).
- **Detector preprocessing contract:** YOLO expects **RGB, letterboxed** to the model's `imgsz` (320 for the placeholder model — it was trained at imgsz 320), pixel `v/255` (NO ImageNet mean/std), CHW `[1,3,320,320]`. Detected box coords come back in letterboxed space and MUST be un-letterboxed to the original frame. The EXACT output tensor shape/names are captured in Task 1 (Step 6) and pinned into Task 3.
- **Index binary format** (little-endian): `uint32 n`, `uint32 dim`, then `n*dim` float32 (row-major embeddings, L2-normalised), then `n` int32 passcodes. Written by `ml.export_assets.export_index_binary`, read by Kotlin `IndexSearcher`.
- Branch: continue on `worktree-scanner-ml-foundation`. Do NOT create a new branch. **Merge caveat:** Tasks 4–5 edit `MainActivity.kt`, which the parallel dashboard session may also edit — expect merge conflicts there later; keep the new pipeline in separate files where possible and touch `MainActivity.kt` minimally.

---

## File Structure

```
ml/
  export_assets.py                 # export_index_binary + export_detector_nms
  tests/test_export_assets.py
android/app/
  build.gradle.kts                 # + onnxruntime-android dep
  src/main/assets/                 # embedder.onnx, detector.onnx, index.bin (added by Task-1 gate)
  src/main/java/com/example/yugiohscanner/ml/
    ImagePrep.kt                   # padToSquare224, letterbox, bitmap<->float helpers
    EmbedderModel.kt               # ONNX embedder wrapper
    IndexSearcher.kt               # index.bin loader + cosine NN
    DetectorModel.kt               # ONNX YOLO(+NMS) wrapper -> boxes
    ScanPipeline.kt                # detect -> crop -> embed -> search per frame
    BoxTracker.kt                  # IoU multi-frame stabilisation
  src/main/java/.../MainActivity.kt # analyzer swap + overlay + batch emit (minimal edits)
```

---

### Task 1: Python asset export (index binary + detector NMS re-export) — pytest-verifiable

**Files:**
- Create: `ml/export_assets.py`, `ml/tests/test_export_assets.py`

**Interfaces:**
- `export_index_binary(npz_path, out_path) -> Path` — reads `{embeddings (N,128) f32, passcodes (N,)}`, writes the little-endian binary format above.
- `export_detector_nms(weights, out_path) -> Path` — `YOLO(weights).export(format="onnx", nms=True)`, moves/returns the onnx at `out_path`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_export_assets.py`

```python
import struct
import numpy as np
from ml import export_assets


def test_export_index_binary_roundtrip(tmp_path):
    emb = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
    pc = np.array([111, 222], dtype=np.int64)
    npz = tmp_path / "idx.npz"
    np.savez(npz, embeddings=emb, passcodes=pc)

    out = export_assets.export_index_binary(npz, tmp_path / "index.bin")
    raw = out.read_bytes()

    n, dim = struct.unpack_from("<II", raw, 0)
    assert (n, dim) == (2, 3)
    floats = np.frombuffer(raw, dtype="<f4", count=n * dim, offset=8)
    assert floats.reshape(n, dim).tolist() == emb.tolist()
    codes = np.frombuffer(raw, dtype="<i4", count=n, offset=8 + n * dim * 4)
    assert codes.tolist() == [111, 222]


def test_export_detector_nms_invokes_export(monkeypatch, tmp_path):
    calls = {}

    class FakeYOLO:
        def __init__(self, w):
            calls["w"] = w

        def export(self, **kw):
            calls["kw"] = kw
            p = tmp_path / "src.onnx"
            p.write_bytes(b"onnx")
            return str(p)

    monkeypatch.setattr(export_assets, "YOLO", FakeYOLO)
    out = export_assets.export_detector_nms("best.pt", tmp_path / "detector.onnx")
    assert calls["kw"]["format"] == "onnx"
    assert calls["kw"]["nms"] is True
    assert out.read_bytes() == b"onnx"
```

- [ ] **Step 2: Run test to verify it fails** — `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_export_assets.py -v` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement** — `ml/export_assets.py`

```python
import shutil
import struct
from pathlib import Path

import numpy as np
from ultralytics import YOLO


def export_index_binary(npz_path, out_path) -> Path:
    data = np.load(npz_path)
    emb = np.ascontiguousarray(data["embeddings"], dtype="<f4")
    pc = np.ascontiguousarray(data["passcodes"], dtype="<i4")
    n, dim = emb.shape
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<II", n, dim))
        f.write(emb.tobytes())
        f.write(pc.tobytes())
    return out_path


def export_detector_nms(weights, out_path) -> Path:
    src = YOLO(weights).export(format="onnx", nms=True)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, out_path)
    return out_path
```

- [ ] **Step 4: Run test to verify it passes** — `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_export_assets.py -v` → PASS.

- [ ] **Step 5: Run the FULL ml suite** — `ml/.venv/Scripts/python.exe -m pytest ml/ -q` → all pass.

- [ ] **Step 6: GATE — build the real assets + PIN the detector ONNX I/O**

Controller runs (the 1000-card `embedder.pt` and detector `best.pt` exist from Phases 2/3):
```bash
# build the index npz for the 1000-card model, then -> binary
ml/.venv/Scripts/python.exe -c "from ml import build_index, generate; items=generate.load_card_manifest()[:1000]; build_index.build_index('ml/data/out/embedder.pt', items, 'ml/data/out/embed_index.npz')"
ml/.venv/Scripts/python.exe -c "from ml import export_assets; print(export_assets.export_index_binary('ml/data/out/embed_index.npz','ml/data/out/index.bin'))"
# re-export detector with NMS
ml/.venv/Scripts/python.exe -c "from ml import export_assets; print(export_assets.export_detector_nms('ml/data/out/runs/detector/weights/best.pt','ml/data/out/detector.onnx'))"
# PIN the ONNX I/O — this output spec drives Task 3's Kotlin decode
ml/.venv/Scripts/python.exe -c "import onnxruntime as ort; s=ort.InferenceSession('ml/data/out/detector.onnx',providers=['CPUExecutionProvider']); print('DET in:',[(i.name,i.shape) for i in s.get_inputs()]); print('DET out:',[(o.name,o.shape) for o in s.get_outputs()])"
ml/.venv/Scripts/python.exe -c "import onnxruntime as ort; s=ort.InferenceSession('ml/data/out/embedder.onnx',providers=['CPUExecutionProvider']); print('EMB in:',[(i.name,i.shape) for i in s.get_inputs()]); print('EMB out:',[(o.name,o.shape) for o in s.get_outputs()])"
```
Record the printed detector input name/shape and **output name/shape** in the ledger — Task 3 decodes exactly that. If `nms=True` is unsupported by this ultralytics/onnx combo (export errors), record that: Task 3 then decodes the RAW YOLO output `[1, 4+nc, anchors]` and implements NMS in Kotlin (fallback path).

Then copy the three assets into the app and confirm sizes:
```bash
mkdir -p android/app/src/main/assets
cp ml/data/out/embedder.onnx ml/data/out/detector.onnx ml/data/out/index.bin android/app/src/main/assets/
ls -la android/app/src/main/assets/
```

- [ ] **Step 7: Commit**

```bash
git add ml/export_assets.py ml/tests/test_export_assets.py android/app/src/main/assets/embedder.onnx android/app/src/main/assets/detector.onnx android/app/src/main/assets/index.bin
git commit -m "feat(ml): asset export (index binary + detector NMS) + bundle onnx/index into app"
```

---

### Task 2: ONNX Runtime dep + EmbedderModel + IndexSearcher + on-device self-test — MANUAL verify

**Files:**
- Modify: `android/app/build.gradle.kts`
- Create: `ml/ImagePrep.kt`, `ml/EmbedderModel.kt`, `ml/IndexSearcher.kt` (under `.../java/com/example/yugiohscanner/ml/`)
- Modify: `MainActivity.kt` (temporary dev self-test call)

**Interfaces:**
- `EmbedderModel(context).embed(square224: Bitmap): FloatArray` (128, normalised)
- `IndexSearcher(context).search(query: FloatArray): Pair<Int, Float>` (passcode, cosine)
- `ImagePrep.padToSquare224(src: Bitmap): Bitmap`

- [ ] **Step 1: Add the dependency** — in `android/app/build.gradle.kts` dependencies:
```kotlin
    // ONNX Runtime (on-device inference)
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
```

- [ ] **Step 2: `ImagePrep.kt`**

```kotlin
package com.example.yugiohscanner.ml

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color

object ImagePrep {
    private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)

    /** Pad to a gray(127) square with the source centered, then scale to 224. Mirrors
     *  Python compose_scene.pad_to_square(fill=127) + cv2.resize. */
    fun padToSquare224(src: Bitmap): Bitmap {
        val side = maxOf(src.width, src.height)
        val square = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val c = Canvas(square)
        c.drawColor(Color.rgb(127, 127, 127))
        c.drawBitmap(src, ((side - src.width) / 2f), ((side - src.height) / 2f), null)
        return Bitmap.createScaledBitmap(square, 224, 224, true)
    }

    /** 224x224 RGB bitmap -> ImageNet-normalised CHW float[1*3*224*224]. */
    fun embedderInput(bmp224: Bitmap): FloatArray {
        val n = 224 * 224
        val px = IntArray(n)
        bmp224.getPixels(px, 0, 224, 0, 0, 224, 224)
        val out = FloatArray(3 * n)
        for (i in 0 until n) {
            val p = px[i]
            val r = ((p shr 16) and 0xFF) / 255f
            val g = ((p shr 8) and 0xFF) / 255f
            val b = (p and 0xFF) / 255f
            out[i] = (r - MEAN[0]) / STD[0]
            out[n + i] = (g - MEAN[1]) / STD[1]
            out[2 * n + i] = (b - MEAN[2]) / STD[2]
        }
        return out
    }
}
```

- [ ] **Step 3: `EmbedderModel.kt`**

```kotlin
package com.example.yugiohscanner.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.nio.FloatBuffer

class EmbedderModel(context: Context) {
    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession =
        env.createSession(context.assets.open("embedder.onnx").readBytes())

    /** Returns the 128-d L2-normalised embedding. */
    fun embed(square224: Bitmap): FloatArray {
        val data = ImagePrep.embedderInput(square224)
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), longArrayOf(1, 3, 224, 224)).use { t ->
            session.run(mapOf("img" to t)).use { res ->
                @Suppress("UNCHECKED_CAST")
                return (res[0].value as Array<FloatArray>)[0]
            }
        }
    }

    fun close() = session.close()
}
```

- [ ] **Step 4: `IndexSearcher.kt`**

```kotlin
package com.example.yugiohscanner.ml

import android.content.Context
import java.nio.ByteBuffer
import java.nio.ByteOrder

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

    /** query must be L2-normalised (embedder output is). Returns (passcode, cosine). */
    fun search(query: FloatArray): Pair<Int, Float> {
        var best = -1
        var bestSim = -2f
        for (i in 0 until n) {
            var s = 0f
            val off = i * dim
            for (d in 0 until dim) s += emb[off + d] * query[d]
            if (s > bestSim) { bestSim = s; best = i }
        }
        return Pair(passcodes[best], bestSim)
    }
}
```

- [ ] **Step 5: Temporary dev self-test** — in `MainActivity.onCreate`, before `setContent`, add a guarded log-only check (remove in Task 4). It bundles nothing new: it embeds one bundled artwork if present, else just constructs the models to prove they load:
```kotlin
try {
    val emb = com.example.yugiohscanner.ml.EmbedderModel(this)
    val idx = com.example.yugiohscanner.ml.IndexSearcher(this)
    // Feed a mid-gray 224 square just to exercise the pipeline shape end-to-end.
    val gray = android.graphics.Bitmap.createBitmap(224, 224, android.graphics.Bitmap.Config.ARGB_8888)
    gray.eraseColor(android.graphics.Color.rgb(127, 127, 127))
    val v = emb.embed(gray)
    val (pc, sim) = idx.search(v)
    android.util.Log.i("MLSelfTest", "emb dim=${v.size} nn passcode=$pc sim=$sim")
    emb.close()
} catch (e: Throwable) {
    android.util.Log.e("MLSelfTest", "self-test failed", e)
}
```

- [ ] **Step 6: MANUAL on-device verification**

Build in Android Studio, run on the device, and check Logcat for tag `MLSelfTest`:
- Expected: `emb dim=128 nn passcode=<some 8-digit> sim=<0..1>` and NO `self-test failed` stack trace.
- This proves: ONNX Runtime loads the embedder, the input shape/name are correct, the index binary parses, and cosine search runs on-device. Report the log line (and any crash) back.

- [ ] **Step 7: Commit** (after the human confirms the log)

```bash
git add android/app/build.gradle.kts android/app/src/main/java/com/example/yugiohscanner/ml/ImagePrep.kt android/app/src/main/java/com/example/yugiohscanner/ml/EmbedderModel.kt android/app/src/main/java/com/example/yugiohscanner/ml/IndexSearcher.kt android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt
git commit -m "feat(android): onnxruntime dep + embedder + index searcher (on-device self-test)"
```

---

### Task 3: DetectorModel + preview box overlay — MANUAL verify

**Files:**
- Create: `ml/DetectorModel.kt`
- Modify: `MainActivity.kt` (overlay of detected boxes; feed frames to the detector)

**Prerequisite:** the detector ONNX input/output spec PINNED in Task 1 Step 6. The code below assumes the common `nms=True` output `[1, N, 6]` = `(x1,y1,x2,y2,score,cls)` in `imgsz`-pixel coords. **Adjust the decode to the pinned spec** (shape, coord order, whether coords are normalised) before building.

**Interfaces:**
- `DetectorModel(context).detect(frame: Bitmap): List<Box>` where `Box(x1,y1,x2,y2,score)` in ORIGINAL frame pixels.

- [ ] **Step 1: `DetectorModel.kt`** (letterbox → run → decode → un-letterbox)

```kotlin
package com.example.yugiohscanner.ml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import java.nio.FloatBuffer

data class Box(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val score: Float)

class DetectorModel(context: Context, private val imgsz: Int = 320, private val conf: Float = 0.35f) {
    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession =
        env.createSession(context.assets.open("detector.onnx").readBytes())

    fun detect(frame: Bitmap): List<Box> {
        // letterbox frame into imgsz square, gray padding
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
        val input = toRgbChw01(letter)               // /255, CHW, no mean/std
        val boxes = ArrayList<Box>()
        OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 3, imgsz.toLong(), imgsz.toLong())).use { t ->
            session.run(mapOf(session.inputNames.iterator().next() to t)).use { res ->
                // EXPECTED nms=True output [1, N, 6] = x1,y1,x2,y2,score,cls (imgsz px). ADJUST per Task-1 pin.
                @Suppress("UNCHECKED_CAST")
                val out = (res[0].value as Array<Array<FloatArray>>)[0]
                for (d in out) {
                    val score = d[4]
                    if (score < conf) continue
                    // un-letterbox back to original frame px
                    val x1 = (d[0] - padX) / scale
                    val y1 = (d[1] - padY) / scale
                    val x2 = (d[2] - padX) / scale
                    val y2 = (d[3] - padY) / scale
                    boxes.add(Box(x1, y1, x2, y2, score))
                }
            }
        }
        return boxes
    }

    private fun toRgbChw01(bmp: Bitmap): FloatArray {
        val n = imgsz * imgsz
        val px = IntArray(n); bmp.getPixels(px, 0, imgsz, 0, 0, imgsz, imgsz)
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
```

- [ ] **Step 2: Overlay in the camera screen.** Add a Compose `Canvas` over the `PreviewView` that draws the current `List<Box>` (scaled from frame px to view px). Feed the `ImageAnalysis` frames (converted to Bitmap, as `CardAnalyzer` already does via `imageProxy.toBitmap()`) into `DetectorModel.detect(...)` on the analyzer executor, and hoist the resulting boxes into Compose state. (Reuse the existing analyzer wiring at the `ImageAnalysis.Builder()` site; run detection at a throttled rate, e.g. skip frames if a detection is in flight.)

- [ ] **Step 3: MANUAL on-device verification.** Build + run. Point the camera at one and several Yu-Gi-Oh cards on a surface.
- Expected: green boxes track the cards in the preview, reasonably tight, updating live. Note the rough FPS/latency (Logcat timing) — this answers the "is on-device inference fast enough?" question. Report box quality + speed + any crash.

- [ ] **Step 4: Commit** (after the human confirms boxes render).

---

### Task 4: Full per-frame pipeline (detect → crop → embed → search) + passcode labels — MANUAL verify

**Files:**
- Create: `ml/ScanPipeline.kt`
- Modify: `MainActivity.kt` (use pipeline; label each box with its passcode; remove the Task-2 self-test)

**Interfaces:**
- `ScanPipeline(context).process(frame: Bitmap): List<Detection>` where `Detection(box: Box, passcode: Int, sim: Float)`.

- [ ] **Step 1: `ScanPipeline.kt`**

```kotlin
package com.example.yugiohscanner.ml

import android.content.Context
import android.graphics.Bitmap

data class Detection(val box: Box, val passcode: Int, val sim: Float)

class ScanPipeline(context: Context, private val minSim: Float = 0.5f) {
    private val detector = DetectorModel(context)
    private val embedder = EmbedderModel(context)
    private val index = IndexSearcher(context)

    fun process(frame: Bitmap): List<Detection> {
        val out = ArrayList<Detection>()
        for (b in detector.detect(frame)) {
            val x = b.x1.toInt().coerceIn(0, frame.width - 1)
            val y = b.y1.toInt().coerceIn(0, frame.height - 1)
            val w = (b.x2 - b.x1).toInt().coerceIn(1, frame.width - x)
            val h = (b.y2 - b.y1).toInt().coerceIn(1, frame.height - y)
            val crop = Bitmap.createBitmap(frame, x, y, w, h)
            val square = ImagePrep.padToSquare224(crop)
            val (pc, sim) = index.search(embedder.embed(square))
            if (sim >= minSim) out.add(Detection(b, pc, sim))
        }
        return out
    }

    fun close() { detector.close(); embedder.close() }
}
```

- [ ] **Step 2:** In the camera screen, feed frames to `ScanPipeline.process`, draw each `Detection`'s box plus its `passcode` as a label. Remove the Task-2 self-test block from `onCreate`.

- [ ] **Step 3: MANUAL on-device verification.** Build + run. Hold up cards that ARE in the 1000-card placeholder index (from `manifest.json[:1000]` — the first 1000 artworks; pick known ones or just observe consistency). Expected: each detected card shows a passcode label that stays stable for the same physical card. Accuracy will be limited by the placeholder model — the point is the end-to-end chain works on-device. Report behaviour + latency.

- [ ] **Step 4: Commit** (after human confirms).

---

### Task 5: Multi-frame tracking + batch confirm + set-code OCR + emit — MANUAL verify

**Files:**
- Create: `ml/BoxTracker.kt`
- Modify: `MainActivity.kt` (tracking, confirmation, per-card set-code OCR, batch `cards_scanned` emit)

- [ ] **Step 1: `BoxTracker.kt`** — IoU-associate detections across frames; a track confirms once it has been the same passcode for N of the last M frames. Emits a confirmed set of `{passcode}` and clears a track when it leaves view (mirrors the existing `CardAnalyzer` window/REQUIRED_HITS idea, but keyed on the matched passcode per track).

```kotlin
package com.example.yugiohscanner.ml

class BoxTracker(private val need: Int = 3, private val iouThresh: Float = 0.4f) {
    private data class Track(var box: Box, val votes: HashMap<Int, Int> = HashMap(), var confirmedEmitted: Boolean = false)
    private val tracks = ArrayList<Track>()

    /** Feed one frame's detections; returns passcodes that JUST reached confirmation this frame. */
    fun update(dets: List<Detection>): List<Int> {
        val newlyConfirmed = ArrayList<Int>()
        val matched = BooleanArray(tracks.size)
        for (d in dets) {
            var bi = -1; var bIoU = iouThresh
            for (i in tracks.indices) { val u = iou(d.box, tracks[i].box); if (u >= bIoU) { bIoU = u; bi = i } }
            val tr = if (bi >= 0) { matched[bi] = true; tracks[bi] } else Track(d.box).also { tracks.add(it) }
            tr.box = d.box
            val c = (tr.votes[d.passcode] ?: 0) + 1
            tr.votes[d.passcode] = c
            if (!tr.confirmedEmitted && c >= need) { tr.confirmedEmitted = true; newlyConfirmed.add(d.passcode) }
        }
        // drop tracks not seen this frame (left view) so re-scan works.
        // matched was sized to the pre-loop track count, so tracks added this frame
        // (index >= matched.size) are never removed — correct, they were just seen.
        for (m in matched.indices.reversed()) { if (!matched[m]) tracks.removeAt(m) }
        return newlyConfirmed
    }

    private fun iou(a: Box, b: Box): Float {
        val ix1 = maxOf(a.x1, b.x1); val iy1 = maxOf(a.y1, b.y1)
        val ix2 = minOf(a.x2, b.x2); val iy2 = minOf(a.y2, b.y2)
        val iw = maxOf(0f, ix2 - ix1); val ih = maxOf(0f, iy2 - iy1)
        val inter = iw * ih
        val ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
        return if (ua <= 0f) 0f else inter / ua
    }
}
```

- [ ] **Step 2: Set-code OCR per confirmed card.** Keep the existing ML Kit `TextRecognition`; when a card confirms, run OCR on that card's box region (crop of the frame) with the existing `setCodePattern` to attach top set codes for rarity. (Reuse the regex from `CardAnalyzer`.)

- [ ] **Step 3: Batch emit.** When `BoxTracker.update` returns newly-confirmed passcodes, accumulate `{passcode, setCodes}` and emit a single `cards_scanned` socket event with a JSON array (extend the existing single `card_scanned` emit; keep `card_scanned` working for the manual-entry path). Desktop side already receives `card_scanned`; the batch channel is a small additive handler there (note for a follow-up desktop change — out of scope for this Android plan, but flag it).

- [ ] **Step 4: MANUAL on-device verification.** Build + run. Lay out several cards and pan across them.
- Expected: each card confirms once (stable), a batch emits, and the desktop Staging shows the scanned cards; where a set code was readable, rarity resolves, else the `Unknown` bucket. Report end-to-end behaviour, mis-detections, and speed.

- [ ] **Step 5: Commit** (after human confirms).

---

## Self-Review

**Spec coverage:** ONNX Runtime on-device (Task 2/3); detector (Task 3); embedder+index NN (Task 2/4); crop→embed→search pipeline (Task 4); multi-frame tracking + batch (Task 5); set-code OCR for rarity (Task 5); assets bundled (Task 1). ✅

**Preprocessing contracts pinned** (embedder ImageNet RGB CHW + pad-to-square; detector letterbox /255) — the two highest-risk consistency points are stated verbatim in Global Constraints and used identically in the wrappers.

**De-risking:** Task 1 Step 6 pins the real detector ONNX I/O so Task 3's decode is not blind; the `nms=True` fallback (Kotlin NMS) is called out.

**Honest gaps:** every Kotlin task is verified only on-device by the human — this plan cannot self-certify them. The placeholder 1000-card model limits recognition accuracy; production models swap in with no code change (same ONNX I/O + index format).

---

## Deferred to a later phase (NOT Phase 4)
- Cloud (Supabase) download + caching of `detector.onnx` / `embedder.onnx` / `index.bin`, replacing the bundled placeholder assets; index versioning/manifest.
- Production models (full 14.7k index, fine-tuned embedder, imgsz-640 detector) — drop-in via the same asset contract.
- Desktop `cards_scanned` batch handler (currently single `card_scanned`); perspective-warp via OBB/corner refinement; real-photo accuracy tuning.
