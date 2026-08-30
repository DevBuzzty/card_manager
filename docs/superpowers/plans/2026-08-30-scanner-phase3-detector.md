# Scanner Phase 3 — Card Detector (YOLO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Train a YOLO11-nano card detector on the Phase-1 synthetic scenes, measure detection quality (mAP / recall) on a held-out val split, and export it to ONNX — all via thin wrappers in the Python `ml/` toolchain.

**Architecture:** Ultralytics YOLO does the training/val/export; we write thin, unit-tested wrappers (a `data.yaml` builder, a train wrapper, an eval+export wrapper). Training data is the Phase-1 generator's YOLO-format output (`ml/data/out/detect/{images,labels}/{train,val}`), which already matches Ultralytics' dataset convention. One class: `card`, axis-aligned boxes. CPU for local validation (small run); full training on cloud GPU later.

**Tech Stack:** Python 3.14 (`ml/.venv`), Ultralytics 8.4 (on top of the existing torch 2.13), reuses Phase-1 `ml.generate` for scene data. pytest with mocked `YOLO` for the wrappers (real training happens only at the gate).

## Global Constraints

- Subsystem stays in `ml/`; all data/weights/runs under `ml/data/` (gitignored) — never commit weights, ONNX, scenes, or Ultralytics `runs/` output.
- `ultralytics` is added to the existing `ml/requirements-train.txt` (not the base `requirements.txt`), installed into `ml/.venv`.
- Dataset layout is the Phase-1 generator's output: `DET_DIR/images/{train,val}` + `DET_DIR/labels/{train,val}` (from `ml.generate.generate_detection_set`). The `data.yaml` points `path` at `DET_DIR`, `train: images/train`, `val: images/val`, one class `0: card`.
- Detector = `yolo11n.pt` (pretrained) fine-tuned; single class; axis-aligned boxes (matches the Phase-1 labels, which are the AABB of the warped card quad). OBB is a later refinement, out of scope.
- Wrapper unit tests MUST mock `ultralytics.YOLO` (no real training / no weight download in the test suite). Import `YOLO` at module level in each wrapper so tests can monkeypatch `<module>.YOLO`.
- Ultralytics output (weights, plots, runs) is directed under `config.OUT_DIR` via `project`/`name`, never the repo root.
- Branch: continue on `worktree-scanner-ml-foundation`. Do NOT create a new branch. Do NOT touch `main` / `feat/android-dashboard`.

---

## File Structure

```
ml/
  requirements-train.txt   # + ultralytics
  detector_data.py         # write_data_yaml() -> data.yaml for Ultralytics
  detector_train.py        # train_detector() wrapper + CLI
  detector_eval.py         # evaluate_detector() + export_detector_onnx() + CLI
  tests/
    test_detector_data.py
    test_detector_train.py
    test_detector_eval.py
```

---

### Task 1: ultralytics dep + data.yaml builder

**Files:**
- Modify: `ml/requirements-train.txt` (append `ultralytics`)
- Create: `ml/detector_data.py`
- Test: `ml/tests/test_detector_data.py`

**Interfaces:**
- Consumes: `ml.config.DET_DIR`.
- Produces: `write_data_yaml(out_path=None) -> Path` — writes an Ultralytics dataset yaml pointing at `DET_DIR` with one class `card`; returns the path.

- [ ] **Step 1: Add dep + install**

Append `ultralytics` to `ml/requirements-train.txt` (new last line). Then:
```bash
ml/.venv/Scripts/python.exe -m pip install ultralytics
```
Expected: installs ultralytics 8.4.x and its deps (pyyaml, pillow, etc.) into the venv. Verify: `ml/.venv/Scripts/python.exe -c "import ultralytics; print(ultralytics.__version__)"`.

- [ ] **Step 2: Write the failing test** — `ml/tests/test_detector_data.py`

```python
from ml import detector_data, config


def test_write_data_yaml(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DET_DIR", tmp_path)
    p = detector_data.write_data_yaml()
    assert p == tmp_path / "data.yaml"
    text = p.read_text()
    assert "train: images/train" in text
    assert "val: images/val" in text
    assert "card" in text
    assert tmp_path.as_posix() in text
```

- [ ] **Step 3: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_data.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.detector_data`.

- [ ] **Step 4: Implement** — `ml/detector_data.py`

```python
from pathlib import Path

from ml import config


def write_data_yaml(out_path=None) -> Path:
    det = config.DET_DIR
    out_path = Path(out_path) if out_path else det / "data.yaml"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    content = (
        f"path: {det.as_posix()}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"names:\n"
        f"  0: card\n"
    )
    out_path.write_text(content)
    return out_path
```

- [ ] **Step 5: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_data.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ml/requirements-train.txt ml/detector_data.py ml/tests/test_detector_data.py
git commit -m "feat(ml): ultralytics dep + YOLO data.yaml builder"
```

---

### Task 2: Train wrapper

**Files:**
- Create: `ml/detector_train.py`
- Test: `ml/tests/test_detector_train.py`

**Interfaces:**
- Consumes: `ultralytics.YOLO`, `ml.config.OUT_DIR`, `ml.detector_data.write_data_yaml`.
- Produces:
  - `train_detector(data_yaml, epochs=50, imgsz=640, model="yolo11n.pt", device="cpu", project=None, name="detector") -> Path` — runs `YOLO(model).train(...)`, returns the best-weights path `Path(project)/name/"weights"/"best.pt"` (project defaults to `str(config.OUT_DIR / "runs")`).
  - `main()` — CLI: `--data`, `--epochs`, `--imgsz`, `--device`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_detector_train.py`

```python
from pathlib import Path
from ml import detector_train


def test_train_detector_invokes_yolo(tmp_path, monkeypatch):
    calls = {}

    class FakeYOLO:
        def __init__(self, model):
            calls["model"] = model

        def train(self, **kw):
            calls["train"] = kw

    monkeypatch.setattr(detector_train, "YOLO", FakeYOLO)
    out = detector_train.train_detector(
        "data.yaml", epochs=3, imgsz=320, device="cpu",
        project=str(tmp_path), name="run",
    )
    assert calls["model"] == "yolo11n.pt"
    assert calls["train"]["data"] == "data.yaml"
    assert calls["train"]["epochs"] == 3
    assert calls["train"]["imgsz"] == 320
    assert calls["train"]["device"] == "cpu"
    assert out == tmp_path / "run" / "weights" / "best.pt"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_train.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.detector_train`.

- [ ] **Step 3: Implement** — `ml/detector_train.py`

```python
import argparse
from pathlib import Path

from ultralytics import YOLO

from ml import config


def train_detector(data_yaml, epochs: int = 50, imgsz: int = 640,
                   model: str = "yolo11n.pt", device: str = "cpu",
                   project=None, name: str = "detector") -> Path:
    project = project or str(config.OUT_DIR / "runs")
    YOLO(model).train(
        data=str(data_yaml), epochs=epochs, imgsz=imgsz,
        device=device, project=project, name=name,
    )
    return Path(project) / name / "weights" / "best.pt"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    best = train_detector(args.data, epochs=args.epochs, imgsz=args.imgsz, device=args.device)
    print(f"best weights -> {best}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_train.py -v`
Expected: PASS. (No real training — `YOLO` is monkeypatched.)

- [ ] **Step 5: Commit**

```bash
git add ml/detector_train.py ml/tests/test_detector_train.py
git commit -m "feat(ml): YOLO detector train wrapper"
```

---

### Task 3: Eval + ONNX export wrapper + gate

**Files:**
- Create: `ml/detector_eval.py`
- Test: `ml/tests/test_detector_eval.py`

**Interfaces:**
- Consumes: `ultralytics.YOLO`.
- Produces:
  - `evaluate_detector(weights, data_yaml) -> dict` — runs `YOLO(weights).val(data=...)`, returns `{"mAP50": float, "mAP50_95": float}` from `results.box.map50` / `results.box.map`.
  - `export_detector_onnx(weights) -> str` — runs `YOLO(weights).export(format="onnx")`, returns its path.
  - `main()` — CLI: `--weights`, `--data`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_detector_eval.py`

```python
from ml import detector_eval


def test_evaluate_detector_returns_metrics(monkeypatch):
    class FakeBox:
        map50 = 0.82
        map = 0.61

    class FakeResults:
        box = FakeBox()

    class FakeYOLO:
        def __init__(self, w):
            pass

        def val(self, **kw):
            assert kw["data"] == "data.yaml"
            return FakeResults()

    monkeypatch.setattr(detector_eval, "YOLO", FakeYOLO)
    m = detector_eval.evaluate_detector("best.pt", "data.yaml")
    assert m == {"mAP50": 0.82, "mAP50_95": 0.61}


def test_export_detector_onnx(monkeypatch):
    calls = {}

    class FakeYOLO:
        def __init__(self, w):
            calls["w"] = w

        def export(self, **kw):
            calls["format"] = kw.get("format")
            return "runs/detector/weights/best.onnx"

    monkeypatch.setattr(detector_eval, "YOLO", FakeYOLO)
    p = detector_eval.export_detector_onnx("best.pt")
    assert calls["w"] == "best.pt"
    assert calls["format"] == "onnx"
    assert p.endswith(".onnx")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_eval.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.detector_eval`.

- [ ] **Step 3: Implement** — `ml/detector_eval.py`

```python
import argparse

from ultralytics import YOLO


def evaluate_detector(weights, data_yaml) -> dict:
    results = YOLO(weights).val(data=str(data_yaml))
    return {"mAP50": float(results.box.map50), "mAP50_95": float(results.box.map)}


def export_detector_onnx(weights) -> str:
    return YOLO(weights).export(format="onnx")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--data", required=True)
    args = parser.parse_args()
    metrics = evaluate_detector(args.weights, args.data)
    print(f"mAP50={metrics['mAP50']:.3f} mAP50-95={metrics['mAP50_95']:.3f}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_detector_eval.py -v`
Expected: PASS.

- [ ] **Step 5: Run the FULL ml suite (no regressions)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/ -q`
Expected: all Phase-1/2/3 tests pass.

- [ ] **Step 6: PHASE-3 GATE — real training + mAP on a small CPU run**

Prerequisite (run by the controller, not the implementer): generate a proper scene set with the Phase-1 generator, then write the data.yaml:
```bash
ml/.venv/Scripts/python.exe -m ml.generate --scenes 500 --seed 1
ml/.venv/Scripts/python.exe -c "from ml import detector_data; print(detector_data.write_data_yaml())"
```
(`generate_detection_set` uses `val_split=0.1` by default, so ~450 train / ~50 val scenes.)

Real run (CPU, small for pipeline validation — NOT production accuracy):
```bash
ml/.venv/Scripts/python.exe -m ml.detector_train --data ml/data/out/detect/data.yaml --epochs 15 --imgsz 320 --device cpu
ml/.venv/Scripts/python.exe -m ml.detector_eval --weights ml/data/out/runs/detector/weights/best.pt --data ml/data/out/detect/data.yaml
ml/.venv/Scripts/python.exe -c "from ml import detector_eval; print(detector_eval.export_detector_onnx('ml/data/out/runs/detector/weights/best.pt'))"
```
Gate check: `detector_eval` prints mAP50 / mAP50-95. Record the numbers. This validates the pipeline end-to-end (a small CPU run over synthetic scenes — expect a REASONABLE-but-not-maxed mAP, since it's few epochs at reduced imgsz; production accuracy comes from a full cloud-GPU run at imgsz 640). Confirm the ONNX file is written.

> **Compute note:** YOLO CPU training is slow. If 15 epochs at imgsz 320 over ~450 scenes is too slow on the day, reduce `--scenes`, `--epochs`, or `--imgsz` further — the goal here is a working pipeline + a printed mAP, not a strong number.

- [ ] **Step 7: Commit**

```bash
git add ml/detector_eval.py ml/tests/test_detector_eval.py
git commit -m "feat(ml): YOLO detector eval + ONNX export + phase-3 gate"
```

---

## Self-Review

**Spec coverage (Phase 3 = card detector → mAP/IoU):**
- Ultralytics dep + dataset yaml (consumes Phase-1 scenes) → Task 1. ✅
- YOLO11-nano train wrapper (single class, axis-aligned) → Task 2. ✅
- Eval (mAP50/mAP50-95) → Task 3. ✅
- ONNX export (later AMD/on-device) → Task 3. ✅
- Real training + measured mAP gate → Task 3 Step 6. ✅
- CPU/hybrid compute (small validation run; full on cloud GPU) → Task 3 gate + compute note. ✅

**Placeholder scan:** every step has complete code; no TBD/TODO.

**Type consistency:** `write_data_yaml() -> Path` (Task 1) consumed by the gate. `train_detector(...) -> Path(best.pt)` (Task 2) feeds `evaluate_detector(weights, data_yaml)` / `export_detector_onnx(weights)` (Task 3). Metrics dict keys `mAP50`/`mAP50_95` consistent. All wrappers import `YOLO` at module level for monkeypatching.

---

## Deferred to a later phase (NOT Phase 3)
- Oriented bounding boxes (OBB) + corner refinement → perspective-warp of detected cards.
- Full cloud-GPU training at imgsz 640 for production mAP.
- Android on-device integration: run detector (ONNX) → crop → embedder (Phase 2) → index NN → multi-card batch + set-code OCR. This is the end-to-end scanner assembly, a distinct later phase.
