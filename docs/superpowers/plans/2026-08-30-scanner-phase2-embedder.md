# Scanner Phase 2 — Embedder Training + Index + Retrieval Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Train a card-artwork embedder (transfer-learning a pretrained MobileNetV3-small with ArcFace metric learning), build a nearest-neighbour embedding index over all artworks, export the model to ONNX, and measure top-1 retrieval accuracy on held-out augmented queries — all in the Python `ml/` toolchain.

**Architecture:** Reuses Phase-1's `augment_crop` for training/eval views. A frozen pretrained backbone + a trained 128-d L2-normalised projection head, optimised with ArcFace over ~N artwork classes. CPU-friendly (freeze backbone) for local validation; the same pipeline scales to a full cloud-GPU fine-tune later. Index build + ONNX export live in Python; the AMD GPU can accelerate ONNX inference later via onnxruntime-directml. Desktop/Node/Supabase integration is a LATER phase, not this one.

**Tech Stack:** Python 3.14 (existing `ml/.venv`), PyTorch 2.13 + torchvision 0.28 (CPU build), OpenCV/NumPy (already present), onnxruntime-directml 1.24 (ONNX verification / AMD inference), pytest. Reuses `ml.config`, `ml.compose_scene.augment_crop`, `ml.generate.load_card_manifest`.

## Global Constraints

- Subsystem stays in `ml/` at repo root; all data/checkpoints/index/onnx artifacts go under `ml/data/` (gitignored) — never commit weights or data.
- Training dependencies go in a SEPARATE `ml/requirements-train.txt` (torch/torchvision/onnxruntime-directml), so the Phase-1 base `requirements.txt` stays light. Installed into the existing `ml/.venv`.
- Input resolution is `config.CROP_SIZE` = **224**; embedding dim = **128**, L2-normalised. These are the fixed model I/O contract.
- One class per **artwork** (each downloaded artwork file = one class); `class_idx → passcode` mapping is carried in the dataset and saved in the checkpoint. Index maps each artwork embedding → its passcode.
- Preprocessing is identical everywhere (train, index, eval): BGR→RGB, /255, ImageNet mean/std normalise, HWC→CHW. Implemented once as `dataset.to_model_tensor` and reused.
- Determinism: pass explicit seeds; `DataLoader(num_workers=0)` (Windows-safe, avoids spawn issues).
- Models built with `pretrained=False` in all tests to avoid network downloads; the real training run uses `pretrained=True`.
- Branch: continue on the existing isolated worktree branch `worktree-scanner-ml-foundation`. Do NOT create a new branch. Do NOT touch `main` / `feat/android-dashboard`.

---

## File Structure

```
ml/
  requirements-train.txt   # torch, torchvision, onnxruntime-directml
  dataset.py               # ArtworkDataset + to_model_tensor (shared preprocessing)
  model.py                 # Embedder (backbone+head) + ArcFace loss head
  train.py                 # training loop + checkpoint + CLI
  build_index.py           # embed all clean arts -> .npz index; ONNX export
  eval_retrieval.py        # top-1 retrieval accuracy + CLI (phase-2 gate)
  tests/
    test_dataset.py
    test_model.py
    test_train.py
    test_build_index.py
    test_eval_retrieval.py
```

Each file is one responsibility: `dataset` (data+preprocessing), `model` (nets), `train` (optimisation), `build_index` (inference→index+onnx), `eval_retrieval` (measurement). They compose linearly.

---

### Task 1: Training deps + dataset + shared preprocessing

**Files:**
- Create: `ml/requirements-train.txt`, `ml/dataset.py`
- Test: `ml/tests/test_dataset.py`

**Interfaces:**
- Consumes: `ml.compose_scene.augment_crop`, `ml.config.CROP_SIZE`.
- Produces:
  - `to_model_tensor(bgr_uint8: np.ndarray) -> torch.Tensor` — (3,224,224) float32, ImageNet-normalised.
  - `ArtworkDataset(items, seed=0)` where `items: list[(passcode:int, path)]`; `.__len__()`, `.num_classes() -> int`, `.passcodes: list[int]` (index→passcode), `.__getitem__(i) -> (tensor(3,224,224), class_idx:int)`.

- [ ] **Step 1: Install training deps** (into existing venv, from repo root)

`ml/requirements-train.txt`:
```
torch>=2.13
torchvision>=0.28
onnxruntime-directml>=1.24
```

Run:
```bash
ml/.venv/Scripts/python.exe -m pip install -r ml/requirements-train.txt
```
Expected: torch/torchvision/onnxruntime-directml install (CPU torch build on Windows; ~200–400 MB, may take a few minutes). If `onnxruntime-directml` conflicts with a pre-existing `onnxruntime`, uninstall plain `onnxruntime` first (they are mutually exclusive). Verify: `ml/.venv/Scripts/python.exe -c "import torch, torchvision; print(torch.__version__, torchvision.__version__)"`.

- [ ] **Step 2: Write the failing test** — `ml/tests/test_dataset.py`

```python
import numpy as np
from ml import dataset, config


def test_to_model_tensor_shape_and_range():
    bgr = np.full((224, 224, 3), 127, dtype=np.uint8)
    t = dataset.to_model_tensor(bgr)
    assert tuple(t.shape) == (3, config.CROP_SIZE, config.CROP_SIZE)
    assert t.dtype.is_floating_point


def test_dataset_len_classes_and_item(monkeypatch):
    items = [(111, "a"), (222, "b"), (111, "c")]  # 3 artworks, note passcode 111 twice
    monkeypatch.setattr(dataset.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    ds = dataset.ArtworkDataset(items, seed=0)
    assert len(ds) == 3
    assert ds.num_classes() == 3
    assert ds.passcodes == [111, 222, 111]
    t, y = ds[1]
    assert tuple(t.shape) == (3, 224, 224)
    assert y == 1
```

- [ ] **Step 3: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_dataset.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.dataset`.

- [ ] **Step 4: Implement** — `ml/dataset.py`

```python
import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from ml import compose_scene, config

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def to_model_tensor(bgr_uint8: np.ndarray) -> torch.Tensor:
    rgb = cv2.cvtColor(bgr_uint8, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(rgb.transpose(2, 0, 1).copy())


class ArtworkDataset(Dataset):
    """One class per artwork. Each __getitem__ returns a freshly augmented
    224x224 view of the artwork plus its class index."""

    def __init__(self, items, seed: int = 0):
        self.items = list(items)                       # [(passcode, path)]
        self.passcodes = [int(pc) for pc, _ in self.items]
        self._rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return len(self.items)

    def num_classes(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        _pc, path = self.items[idx]
        art = compose_scene.load_art_bgr(path)
        crop = compose_scene.augment_crop(art, self._rng)   # 224x224 BGR uint8
        return to_model_tensor(crop), idx
```

- [ ] **Step 5: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_dataset.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add ml/requirements-train.txt ml/dataset.py ml/tests/test_dataset.py
git commit -m "feat(ml): training deps + ArtworkDataset with shared preprocessing"
```

---

### Task 2: Embedder model + ArcFace head

**Files:**
- Create: `ml/model.py`
- Test: `ml/tests/test_model.py`

**Interfaces:**
- Consumes: torch, torchvision.
- Produces:
  - `Embedder(embed_dim=128, freeze_backbone=True, pretrained=True)` — `forward(x(B,3,224,224)) -> (B,128)` L2-normalised.
  - `ArcFace(embed_dim, n_classes, s=30.0, m=0.5)` — `forward(emb(B,128), labels(B,)) -> logits(B,n_classes)`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_model.py`

```python
import torch
from ml import model as M


def test_embedder_output_is_normalised():
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False).eval()
    x = torch.randn(2, 3, 224, 224)
    with torch.no_grad():
        out = emb(x)
    assert tuple(out.shape) == (2, 128)
    norms = out.norm(dim=1)
    assert torch.allclose(norms, torch.ones(2), atol=1e-4)


def test_embedder_freezes_backbone():
    emb = M.Embedder(freeze_backbone=True, pretrained=False)
    assert all(not p.requires_grad for p in emb.features.parameters())
    assert all(p.requires_grad for p in emb.head.parameters())


def test_arcface_logits_shape_and_loss():
    arc = M.ArcFace(embed_dim=128, n_classes=5)
    emb = torch.nn.functional.normalize(torch.randn(4, 128), dim=1)
    labels = torch.tensor([0, 1, 2, 3])
    logits = arc(emb, labels)
    assert tuple(logits.shape) == (4, 5)
    loss = torch.nn.functional.cross_entropy(logits, labels)
    assert torch.isfinite(loss)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_model.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.model`.

- [ ] **Step 3: Implement** — `ml/model.py`

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models


class Embedder(nn.Module):
    def __init__(self, embed_dim: int = 128, freeze_backbone: bool = True, pretrained: bool = True):
        super().__init__()
        weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = models.mobilenet_v3_small(weights=weights)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)
        in_dim = backbone.classifier[0].in_features   # 576 for mobilenet_v3_small
        self.head = nn.Linear(in_dim, embed_dim)
        if freeze_backbone:
            for p in self.features.parameters():
                p.requires_grad = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.pool(x).flatten(1)
        x = self.head(x)
        return F.normalize(x, dim=1)


class ArcFace(nn.Module):
    """Additive angular margin head. `emb` is expected L2-normalised."""

    def __init__(self, embed_dim: int, n_classes: int, s: float = 30.0, m: float = 0.5):
        super().__init__()
        self.weight = nn.Parameter(torch.empty(n_classes, embed_dim))
        nn.init.xavier_uniform_(self.weight)
        self.s = s
        self.m = m

    def forward(self, emb: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        cos = emb @ F.normalize(self.weight, dim=1).t()
        cos = cos.clamp(-1 + 1e-7, 1 - 1e-7)
        theta = torch.acos(cos)
        onehot = torch.zeros_like(cos)
        onehot.scatter_(1, labels.view(-1, 1), 1.0)
        margined = torch.cos(theta + self.m * onehot)
        return self.s * margined
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_model.py -v`
Expected: PASS (3 passed). (Uses `pretrained=False`, so no network.)

- [ ] **Step 5: Commit**

```bash
git add ml/model.py ml/tests/test_model.py
git commit -m "feat(ml): MobileNetV3-small embedder + ArcFace head"
```

---

### Task 3: Training loop + checkpoint

**Files:**
- Create: `ml/train.py`
- Test: `ml/tests/test_train.py`

**Interfaces:**
- Consumes: `ml.dataset.ArtworkDataset`, `ml.model.{Embedder,ArcFace}`, `ml.generate.load_card_manifest`, `ml.config`.
- Produces:
  - `train(items, out_path, epochs=5, embed_dim=128, freeze_backbone=True, pretrained=True, batch=64, lr=1e-3, device="cpu", seed=0) -> Path` — writes a checkpoint dict `{"embed_dim", "state_dict", "passcodes"}`, returns `out_path`.
  - `main()` — CLI: `--cards-limit`, `--epochs`, `--freeze/--no-freeze`, `--out`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_train.py`

```python
import numpy as np
import torch
from ml import train, dataset


def test_train_writes_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(dataset.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    items = [(111, "a"), (222, "b"), (333, "c"), (444, "d")]
    out = tmp_path / "ckpt.pt"
    result = train.train(items, out_path=out, epochs=1, pretrained=False, batch=2, seed=0)
    assert result == out and out.exists()
    ckpt = torch.load(out, map_location="cpu", weights_only=True)
    assert ckpt["embed_dim"] == 128
    assert ckpt["passcodes"] == [111, 222, 333, 444]
    assert "state_dict" in ckpt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_train.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.train`.

- [ ] **Step 3: Implement** — `ml/train.py`

```python
import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ml import config, dataset
from ml import model as M
from ml.generate import load_card_manifest


def train(items, out_path, epochs: int = 5, embed_dim: int = 128,
          freeze_backbone: bool = True, pretrained: bool = True,
          batch: int = 64, lr: float = 1e-3, device: str = "cpu", seed: int = 0) -> Path:
    torch.manual_seed(seed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    ds = dataset.ArtworkDataset(items, seed=seed)
    dl = DataLoader(ds, batch_size=batch, shuffle=True, num_workers=0)

    emb = M.Embedder(embed_dim, freeze_backbone=freeze_backbone, pretrained=pretrained).to(device)
    arc = M.ArcFace(embed_dim, ds.num_classes()).to(device)
    params = [p for p in emb.parameters() if p.requires_grad] + list(arc.parameters())
    opt = torch.optim.Adam(params, lr=lr)
    loss_fn = torch.nn.CrossEntropyLoss()

    for ep in range(epochs):
        emb.train()
        running = 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            loss = loss_fn(arc(emb(x), y), y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += loss.item() * len(y)
        print(f"epoch {ep}: loss {running / len(ds):.4f}")

    torch.save({"embed_dim": embed_dim, "state_dict": emb.state_dict(),
                "passcodes": ds.passcodes}, out_path)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-limit", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--no-freeze", dest="freeze", action="store_false")
    parser.add_argument("--out", default=str(config.OUT_DIR / "embedder.pt"))
    args = parser.parse_args()
    items = load_card_manifest()
    if args.cards_limit:
        items = items[: args.cards_limit]
    train(items, out_path=args.out, epochs=args.epochs, freeze_backbone=args.freeze)
    print(f"trained on {len(items)} artworks -> {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_train.py -v`
Expected: PASS (1 passed). Confirms end-to-end train step + checkpoint on a random (pretrained=False) backbone, no network.

- [ ] **Step 5: Commit**

```bash
git add ml/train.py ml/tests/test_train.py
git commit -m "feat(ml): embedder training loop + checkpoint"
```

---

### Task 4: Index build + ONNX export

**Files:**
- Create: `ml/build_index.py`
- Test: `ml/tests/test_build_index.py`

**Interfaces:**
- Consumes: `ml.model.Embedder`, `ml.dataset.to_model_tensor`, `ml.compose_scene.load_art_bgr`, `ml.config`.
- Produces:
  - `load_embedder(ckpt_path, device="cpu") -> (Embedder(eval), passcodes:list[int])`.
  - `embed_clean(emb, items, device="cpu") -> np.ndarray (N,128) float32` — CENTER crop (resize, no augmentation).
  - `build_index(ckpt_path, items, out_npz) -> Path` — saves `embeddings (N,128)`, `passcodes (N,)`.
  - `export_onnx(ckpt_path, out_onnx) -> Path`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_build_index.py`

```python
import numpy as np
import torch
from ml import build_index, compose_scene
from ml import model as M


def _make_ckpt(tmp_path):
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False)
    ckpt = tmp_path / "ckpt.pt"
    torch.save({"embed_dim": 128, "state_dict": emb.state_dict(),
                "passcodes": [111, 222]}, ckpt)
    return ckpt


def test_build_index_shapes(tmp_path, monkeypatch):
    monkeypatch.setattr(compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    ckpt = _make_ckpt(tmp_path)
    items = [(111, "a"), (222, "b")]
    out = tmp_path / "index.npz"
    build_index.build_index(ckpt, items, out)
    data = np.load(out)
    assert data["embeddings"].shape == (2, 128)
    assert list(data["passcodes"]) == [111, 222]
    # embeddings are L2-normalised
    norms = np.linalg.norm(data["embeddings"], axis=1)
    assert np.allclose(norms, 1.0, atol=1e-4)


def test_export_onnx_runs(tmp_path, monkeypatch):
    import onnxruntime as ort
    ckpt = _make_ckpt(tmp_path)
    out = tmp_path / "embedder.onnx"
    build_index.export_onnx(ckpt, out)
    assert out.exists()
    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    dummy = np.zeros((1, 3, 224, 224), dtype=np.float32)
    (emb,) = sess.run(None, {"img": dummy})
    assert emb.shape == (1, 128)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_build_index.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.build_index`.

- [ ] **Step 3: Implement** — `ml/build_index.py`

```python
from pathlib import Path

import cv2
import numpy as np
import torch

from ml import config, dataset
from ml import model as M
from ml import compose_scene


def load_embedder(ckpt_path, device: str = "cpu"):
    # weights_only=True: our checkpoint holds only tensors + simple types (int, list),
    # and avoids arbitrary-code execution on unpickle (important once ckpts come from elsewhere).
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=True)
    emb = M.Embedder(ckpt["embed_dim"], freeze_backbone=True, pretrained=False)
    emb.load_state_dict(ckpt["state_dict"])
    emb.eval().to(device)
    return emb, ckpt["passcodes"]


def embed_clean(emb, items, device: str = "cpu") -> np.ndarray:
    vecs = []
    with torch.no_grad():
        for _pc, path in items:
            bgr = compose_scene.load_art_bgr(path)
            crop = cv2.resize(bgr, (config.CROP_SIZE, config.CROP_SIZE))
            t = dataset.to_model_tensor(crop).unsqueeze(0).to(device)
            vecs.append(emb(t).cpu().numpy()[0])
    return np.stack(vecs).astype(np.float32)


def build_index(ckpt_path, items, out_npz) -> Path:
    out_npz = Path(out_npz)
    out_npz.parent.mkdir(parents=True, exist_ok=True)
    emb, _ = load_embedder(ckpt_path)
    embeddings = embed_clean(emb, items)
    passcodes = np.array([int(pc) for pc, _ in items], dtype=np.int64)
    np.savez(out_npz, embeddings=embeddings, passcodes=passcodes)
    return out_npz


def export_onnx(ckpt_path, out_onnx) -> Path:
    out_onnx = Path(out_onnx)
    out_onnx.parent.mkdir(parents=True, exist_ok=True)
    emb, _ = load_embedder(ckpt_path)
    dummy = torch.zeros(1, 3, config.CROP_SIZE, config.CROP_SIZE)
    torch.onnx.export(
        emb, dummy, str(out_onnx),
        input_names=["img"], output_names=["emb"],
        dynamic_axes={"img": {0: "n"}, "emb": {0: "n"}},
        opset_version=17,
    )
    return out_onnx
```

> **Note on ONNX export:** if torch 2.13's default exporter path errors, pass `dynamo=False` to `torch.onnx.export` to force the classic tracer. Keep opset 17.

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_build_index.py -v`
Expected: PASS (2 passed). Note: `onnxruntime` is provided by the `onnxruntime-directml` package; the test uses the CPU provider for portability.

- [ ] **Step 5: Commit**

```bash
git add ml/build_index.py ml/tests/test_build_index.py
git commit -m "feat(ml): embedding index build + ONNX export"
```

---

### Task 5: Retrieval eval + phase-2 gate

**Files:**
- Create: `ml/eval_retrieval.py`
- Test: `ml/tests/test_eval_retrieval.py`

**Interfaces:**
- Consumes: `ml.build_index.{load_embedder,embed_clean}`, `ml.dataset.to_model_tensor`, `ml.compose_scene.{load_art_bgr,augment_crop}`, `ml.generate.load_card_manifest`.
- Produces:
  - `top1_accuracy(index_emb, index_passcodes, query_emb, query_passcodes) -> float` — cosine NN, fraction where nearest index passcode == query passcode.
  - `evaluate(ckpt_path, items, n_queries_per=3, seed=123) -> float` — index = clean embeddings; queries = augmented crops of the same items; returns top-1.
  - `main()` — CLI: `--cards-limit`, `--ckpt`, `--queries`.

- [ ] **Step 1: Write the failing test** — `ml/tests/test_eval_retrieval.py`

```python
import numpy as np
from ml import eval_retrieval, compose_scene


def test_top1_accuracy_pure():
    # index has two clearly separated unit vectors
    index_emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    index_pc = np.array([111, 222])
    # queries near each of them
    query_emb = np.array([[0.9, 0.1], [0.1, 0.9]], dtype=np.float32)
    query_emb /= np.linalg.norm(query_emb, axis=1, keepdims=True)
    query_pc = np.array([111, 222])
    assert eval_retrieval.top1_accuracy(index_emb, index_pc, query_emb, query_pc) == 1.0
    # swap query labels -> all wrong
    assert eval_retrieval.top1_accuracy(index_emb, index_pc, query_emb, np.array([222, 111])) == 0.0


def test_evaluate_returns_fraction(tmp_path, monkeypatch):
    import torch
    from ml import model as M
    monkeypatch.setattr(compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False)
    ckpt = tmp_path / "ckpt.pt"
    torch.save({"embed_dim": 128, "state_dict": emb.state_dict(), "passcodes": [1, 2]}, ckpt)
    acc = eval_retrieval.evaluate(ckpt, [(1, "a"), (2, "b")], n_queries_per=2, seed=0)
    assert 0.0 <= acc <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_eval_retrieval.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.eval_retrieval`.

- [ ] **Step 3: Implement** — `ml/eval_retrieval.py`

```python
import argparse

import numpy as np
import torch

from ml import build_index, compose_scene, dataset
from ml.generate import load_card_manifest


def top1_accuracy(index_emb, index_passcodes, query_emb, query_passcodes) -> float:
    sims = query_emb @ index_emb.T           # (Q, N), both L2-normalised
    nn = sims.argmax(axis=1)
    pred = np.asarray(index_passcodes)[nn]
    return float((pred == np.asarray(query_passcodes)).mean())


def evaluate(ckpt_path, items, n_queries_per: int = 3, seed: int = 123) -> float:
    emb, _ = build_index.load_embedder(ckpt_path)
    index_emb = build_index.embed_clean(emb, items)
    index_pc = np.array([int(pc) for pc, _ in items], dtype=np.int64)

    rng = np.random.default_rng(seed)
    q_emb, q_pc = [], []
    with torch.no_grad():
        for pc, path in items:
            bgr = compose_scene.load_art_bgr(path)
            for _ in range(n_queries_per):
                crop = compose_scene.augment_crop(bgr, rng)
                t = dataset.to_model_tensor(crop).unsqueeze(0)
                q_emb.append(emb(t).numpy()[0])
                q_pc.append(int(pc))
    return top1_accuracy(index_emb, index_pc, np.stack(q_emb).astype(np.float32), np.array(q_pc))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-limit", type=int, default=None)
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--queries", type=int, default=3)
    args = parser.parse_args()
    items = load_card_manifest()
    if args.cards_limit:
        items = items[: args.cards_limit]
    acc = evaluate(args.ckpt, items, n_queries_per=args.queries)
    print(f"top-1 retrieval accuracy on {len(items)} artworks "
          f"({args.queries} queries each): {acc:.3f}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_eval_retrieval.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the FULL ml suite (no regressions)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/ -q`
Expected: all Phase-1 + Phase-2 tests pass.

- [ ] **Step 6: PHASE-2 GATE — real training + index + top-1 on a subset**

Prerequisite (run by the controller, not the implementer): ensure ~1000–2000 artworks are downloaded (`ml/.venv/Scripts/python.exe -m ml.download_cards --limit 1500`).

Real run (CPU, frozen backbone, pretrained):
```bash
ml/.venv/Scripts/python.exe -m ml.train --cards-limit 1000 --epochs 8 --out ml/data/out/embedder.pt
ml/.venv/Scripts/python.exe -m ml.eval_retrieval --cards-limit 1000 --ckpt ml/data/out/embedder.pt --queries 3
```
Gate check: `eval_retrieval` prints a top-1 accuracy. Record the number. This validates the pipeline end-to-end (a frozen-backbone CPU run over a subset — expect a MODERATE top-1, not production-level; that is the deliverable of this phase). Also export ONNX once and confirm it loads:
```bash
ml/.venv/Scripts/python.exe -c "from ml import build_index; build_index.export_onnx('ml/data/out/embedder.pt', 'ml/data/out/embedder.onnx'); print('onnx ok')"
```

- [ ] **Step 7: Commit**

```bash
git add ml/eval_retrieval.py ml/tests/test_eval_retrieval.py
git commit -m "feat(ml): top-1 retrieval eval + phase-2 gate"
```

---

## Self-Review

**Spec coverage (Phase 2 = embedder training + desktop index → top-1 retrieval):**
- Transfer-learning embedder (frozen MobileNetV3-small + head) → Task 2. ✅
- ArcFace metric learning → Task 2. ✅
- Reuse Phase-1 augment_crop for views → Tasks 1/3/5. ✅
- Training loop + checkpoint → Task 3. ✅
- Index build (embed all clean arts) → Task 4. ✅
- ONNX export (for AMD/DirectML + later desktop) → Task 4. ✅
- Top-1 retrieval accuracy gate → Task 5. ✅
- CPU-friendly / hybrid compute (freeze + subset validation) → Tasks 3/5 flags + gate. ✅

**Placeholder scan:** every step has complete code; the one conditional note (ONNX `dynamo=False` fallback) is a documented contingency, not a placeholder.

**Type consistency:** `to_model_tensor` (dataset) reused by train/build_index/eval. `Embedder(embed_dim, freeze_backbone, pretrained)` signature identical across model/train/build_index. Checkpoint dict `{embed_dim, state_dict, passcodes}` written by train, read by build_index/eval. `embed_clean`/`load_embedder` defined in build_index, consumed by eval. `top1_accuracy(index_emb, index_passcodes, query_emb, query_passcodes)` consistent.

---

## Deferred to a later phase (NOT Phase 2)
- Desktop/Electron (`onnxruntime-node`) integration + Supabase index/model delivery + phone-side sync.
- Full 14.7k cloud-GPU fine-tune (unfrozen backbone) for production accuracy — this plan's pipeline supports it via `--no-freeze` + a full `--cards-limit` on GPU.
- The card **detector** (Phase 3) and its training.
