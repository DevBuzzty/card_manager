# Scanner Phase 1 — Fundament (Bulk-Download + Synthese-Generator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Python-Toolchain (`ml/`) das alle YGO-Artworks + ein Hintergrund-Dataset lädt und daraus synthetische Trainingsdaten erzeugt — annotierte Multi-Karten-Szenen (für den Detector) und augmentierte Einzel-Art-Crops (für den Embedder).

**Architecture:** Neues, vom Rest der App entkoppeltes Subsystem `ml/` (reines Python, kein Bezug zu `desktop/` oder `android/`). Ein Synthese-Generator komponiert Kartenbilder mit Perspektive, Beleuchtung, Foil-Glanz, Unschärfe und Überlappung auf reale Texturen (DTD). Ausgabe = YOLO-Szenen + Embedder-Crops auf Platte.

**Tech Stack:** Python 3.14 (venv), NumPy, OpenCV (`opencv-python`), stdlib `urllib`/`tarfile`, pytest. Bewusst KEINE schweren Deps (kein Pillow, kein Albumentations, kein requests) — minimiert Risiko auf dem sehr neuen Python 3.14.

## Global Constraints

- Zielverzeichnis des Subsystems: `ml/` im Repo-Root (neben `desktop/`, `android/`).
- Alle heruntergeladenen/generierten Daten liegen unter `ml/data/` und sind **gitignored** (nie committen).
- Karten-Datenquelle: `https://db.ygoprodeck.com/api/v7/cardinfo.php` (ohne Parameter = alle Karten). Artwork-URL-Feld: `card_images[i].image_url_cropped`. Passcode = `card.id`, Artwork-ID = `card_images[i].id`.
- Hintergrund-Dataset: DTD `https://www.robots.ox.ac.uk/~vgg/data/dtd/download/dtd-r1.0.1.tar.gz`.
- Szenen-Auflösung: **640×640**. Embedder-Crop-Auflösung: **224×224**. Eine YOLO-Klasse: `card` = Klassen-ID `0`.
- Determinismus: jede Zufallsoperation läuft über einen übergebenen `numpy.random.Generator` (Seed-Parameter), damit Generierung reproduzierbar ist.
- Package-Layout: `ml/` und `ml/tests/` sind Python-Packages (`__init__.py`). Alle Imports absolut über `ml.*`. Tests laufen mit `pytest` vom Repo-Root.
- Branch: die gesamte Phase 1 läuft auf `feat/scanner-ml-foundation` (nicht auf `main`).

---

## File Structure

```
ml/
  __init__.py
  README.md
  requirements.txt
  .gitignore
  config.py                 # Pfade, URLs, Konstanten (SCENE_SIZE, CROP_SIZE, CARD_CLASS)
  download_cards.py         # cardinfo holen -> Artworks laden -> manifest.json
  download_backgrounds.py   # DTD laden + entpacken + auflisten
  augment.py                # atomare Augmentierungen (Warp, Licht, Foil-Glanz, Blur/Noise)
  compose_scene.py          # Karten auf Hintergrund komponieren -> Szene + Boxen; Crop-Augmentierung
  generate.py               # CLI: Detection-Set + Embedder-Preview erzeugen; Box-Debug-Overlay
  data/                     # (gitignored) cards/ backgrounds/ out/
  tests/
    __init__.py
    test_config.py
    test_download_cards.py
    test_download_backgrounds.py
    test_augment.py
    test_compose_scene.py
    test_generate.py
```

Verantwortlichkeiten: `augment.py` = zustandslose Bild-Primitive. `compose_scene.py` = Kompositionslogik + Box-Berechnung. `download_*.py` = reine I/O-Beschaffung. `generate.py` = Orchestrierung + CLI. Getrennt, damit jede Datei fokussiert und isoliert testbar bleibt.

---

### Task 1: `ml/`-Scaffold, venv, Deps, Config

**Files:**
- Create: `ml/__init__.py`, `ml/tests/__init__.py`, `ml/requirements.txt`, `ml/.gitignore`, `ml/config.py`, `ml/README.md`
- Test: `ml/tests/test_config.py`

**Interfaces:**
- Consumes: nichts.
- Produces: Modul `ml.config` mit Konstanten `ML_DIR, DATA_DIR, CARDS_DIR, BG_DIR, OUT_DIR, DET_DIR, EMB_DIR` (alle `pathlib.Path`), `CARDINFO_URL, DTD_URL` (str), `SCENE_SIZE=640`, `CROP_SIZE=224`, `CARD_CLASS=0` (int).

- [ ] **Step 1: Feature-Branch anlegen**

Run:
```bash
git checkout -b feat/scanner-ml-foundation
```

- [ ] **Step 2: Dateien anlegen**

`ml/__init__.py` und `ml/tests/__init__.py`: leer.

`ml/requirements.txt`:
```
numpy>=1.26
opencv-python>=4.9
pytest>=8
```

`ml/.gitignore`:
```
.venv/
data/
__pycache__/
*.pyc
```

`ml/config.py`:
```python
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
CARDS_DIR = DATA_DIR / "cards"          # heruntergeladene Artworks (<artwork_id>.jpg) + manifest.json
BG_DIR = DATA_DIR / "backgrounds"        # DTD-Bilder
OUT_DIR = DATA_DIR / "out"               # generierte Trainingsdaten
DET_DIR = OUT_DIR / "detect"             # YOLO-Szenen (images/, labels/)
EMB_DIR = OUT_DIR / "embed"              # augmentierte Einzel-Crops (Preview / Phase 2)

CARDINFO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
DTD_URL = "https://www.robots.ox.ac.uk/~vgg/data/dtd/download/dtd-r1.0.1.tar.gz"

SCENE_SIZE = 640     # Detektor-Szene (Quadrat, px)
CROP_SIZE = 224      # Embedder-Crop (Quadrat, px)
CARD_CLASS = 0       # einzige YOLO-Klasse: "card"
```

`ml/README.md`: kurzer Absatz was `ml/` ist + Setup-Befehle (venv, `pip install -r requirements.txt`, `pytest`).

- [ ] **Step 3: venv erstellen und Deps installieren** (PowerShell, vom Repo-Root)

```bash
python -m venv ml/.venv
ml/.venv/Scripts/python.exe -m pip install --upgrade pip
ml/.venv/Scripts/python.exe -m pip install -r ml/requirements.txt
```
Erwartet: Installation ohne Fehler. Falls `opencv-python` auf Python 3.14 kein Wheel hat: im README als bekannte Hürde notieren und `opencv-python-headless` als Alternative testen.

- [ ] **Step 4: Failing test schreiben** — `ml/tests/test_config.py`

```python
from ml import config


def test_paths_are_under_ml_data():
    assert config.CARDS_DIR.parent == config.DATA_DIR
    assert config.DET_DIR.parent == config.OUT_DIR


def test_size_constants():
    assert config.SCENE_SIZE == 640
    assert config.CROP_SIZE == 224
    assert config.CARD_CLASS == 0
```

- [ ] **Step 5: Test laufen lassen (muss zunächst grün sein, da config existiert)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_config.py -v`
Expected: PASS. (Falls Import scheitert → Package-Layout/`__init__.py` prüfen.)

- [ ] **Step 6: Commit**

```bash
git add ml/__init__.py ml/tests/__init__.py ml/requirements.txt ml/.gitignore ml/config.py ml/README.md ml/tests/test_config.py
git commit -m "feat(ml): scaffold ml toolchain, venv deps, config constants"
```

---

### Task 2: Karten-Downloader

**Files:**
- Create: `ml/download_cards.py`
- Test: `ml/tests/test_download_cards.py`

**Interfaces:**
- Consumes: `ml.config`.
- Produces:
  - `fetch_card_manifest(url: str = config.CARDINFO_URL) -> list[dict]` — je Artwork ein Dict `{"passcode": int, "artwork_id": int, "url": str}`.
  - `save_manifest(entries: list[dict], dest: Path = config.CARDS_DIR) -> Path` — schreibt `manifest.json`, gibt den Pfad zurück.
  - `download_artworks(entries: list[dict], dest: Path = config.CARDS_DIR, limit: int | None = None) -> int` — lädt fehlende `<artwork_id>.jpg`, gibt Anzahl neu geladener Dateien zurück.
  - `main()` — CLI (`argparse`, `--limit N`).

- [ ] **Step 1: Failing test schreiben** — `ml/tests/test_download_cards.py`

```python
import io
import json
from ml import download_cards


FAKE_API = {
    "data": [
        {"id": 46986414, "card_images": [
            {"id": 46986414, "image_url_cropped": "http://x/46986414.jpg"},
            {"id": 46986415, "image_url_cropped": "http://x/46986415.jpg"},
        ]},
        {"id": 89631139, "card_images": [
            {"id": 89631139, "image_url_cropped": "http://x/89631139.jpg"},
        ]},
    ]
}


def test_fetch_card_manifest_flattens_artworks(monkeypatch):
    def fake_urlopen(url, timeout=0):
        return io.BytesIO(json.dumps(FAKE_API).encode())
    monkeypatch.setattr(download_cards.urllib.request, "urlopen", fake_urlopen)

    entries = download_cards.fetch_card_manifest("http://ignored")

    assert len(entries) == 3
    assert entries[0] == {"passcode": 46986414, "artwork_id": 46986414, "url": "http://x/46986414.jpg"}
    assert entries[1]["artwork_id"] == 46986415
    assert entries[2]["passcode"] == 89631139


def test_save_manifest_roundtrip(tmp_path):
    entries = [{"passcode": 1, "artwork_id": 2, "url": "u"}]
    path = download_cards.save_manifest(entries, dest=tmp_path)
    assert json.loads(path.read_text()) == entries
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_download_cards.py -v`
Expected: FAIL — `ModuleNotFoundError: ml.download_cards`.

- [ ] **Step 3: Minimale Implementierung** — `ml/download_cards.py`

```python
import argparse
import json
import urllib.request
from pathlib import Path

from ml import config


def fetch_card_manifest(url: str = config.CARDINFO_URL) -> list[dict]:
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.load(resp)
    entries: list[dict] = []
    for card in payload["data"]:
        passcode = int(card["id"])
        for img in card.get("card_images", []):
            entries.append({
                "passcode": passcode,
                "artwork_id": int(img["id"]),
                "url": img["image_url_cropped"],
            })
    return entries


def save_manifest(entries: list[dict], dest: Path = config.CARDS_DIR) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / "manifest.json"
    path.write_text(json.dumps(entries))
    return path


def download_artworks(entries: list[dict], dest: Path = config.CARDS_DIR, limit: int | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for e in entries[: limit or len(entries)]:
        target = dest / f"{e['artwork_id']}.jpg"
        if target.exists():
            continue
        try:
            urllib.request.urlretrieve(e["url"], target)
            n += 1
        except Exception as exc:  # noqa: BLE001 — einzelne Fehl-Downloads dürfen den Lauf nicht killen
            print(f"skip {e['artwork_id']}: {exc}")
    return n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    entries = fetch_card_manifest()
    save_manifest(entries)
    got = download_artworks(entries, limit=args.limit)
    print(f"manifest: {len(entries)} artworks; downloaded {got} new files")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test laufen lassen (muss grün sein)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_download_cards.py -v`
Expected: PASS.

- [ ] **Step 5: Smoke-Run gegen die echte API (klein)**

Run: `ml/.venv/Scripts/python.exe -m ml.download_cards --limit 20`
Expected: `manifest.json` in `ml/data/cards/` + 20 `.jpg`-Dateien. Kurz ein Bild öffnen → echtes Artwork-Crop.

- [ ] **Step 6: Commit**

```bash
git add ml/download_cards.py ml/tests/test_download_cards.py
git commit -m "feat(ml): card artwork downloader + manifest"
```

---

### Task 3: Hintergrund-Downloader (DTD)

**Files:**
- Create: `ml/download_backgrounds.py`
- Test: `ml/tests/test_download_backgrounds.py`

**Interfaces:**
- Consumes: `ml.config`.
- Produces:
  - `extract_archive(tar_path: Path, dest: Path) -> None` — entpackt ein `.tar.gz` sicher (`filter="data"`).
  - `list_backgrounds(directory: Path = config.BG_DIR) -> list[Path]` — alle `.jpg`/`.png` rekursiv, sortiert.
  - `download_dtd(dest: Path = config.BG_DIR) -> None` — lädt + entpackt DTD.
  - `main()`.

- [ ] **Step 1: Failing test schreiben** — `ml/tests/test_download_backgrounds.py`

```python
import io
import tarfile
from ml import download_backgrounds


def test_extract_and_list(tmp_path):
    # Mini-tar.gz mit einer Fake-"Bild"-Datei bauen
    archive = tmp_path / "mini.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        data = b"not-a-real-image"
        info = tarfile.TarInfo(name="dtd/images/banded/x.jpg")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    out = tmp_path / "bg"
    download_backgrounds.extract_archive(archive, out)
    found = download_backgrounds.list_backgrounds(out)

    assert len(found) == 1
    assert found[0].name == "x.jpg"
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_download_backgrounds.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Minimale Implementierung** — `ml/download_backgrounds.py`

```python
import tarfile
import urllib.request
from pathlib import Path

from ml import config

_EXTS = {".jpg", ".jpeg", ".png"}


def extract_archive(tar_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(dest, filter="data")


def list_backgrounds(directory: Path = config.BG_DIR) -> list[Path]:
    return sorted(p for p in directory.rglob("*") if p.suffix.lower() in _EXTS)


def download_dtd(dest: Path = config.BG_DIR) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "dtd.tar.gz"
    if not archive.exists():
        print("downloading DTD (~600 MB)…")
        urllib.request.urlretrieve(config.DTD_URL, archive)
    extract_archive(archive, dest)
    print(f"backgrounds ready: {len(list_backgrounds(dest))} images")


def main() -> None:
    download_dtd()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test laufen lassen (muss grün sein)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_download_backgrounds.py -v`
Expected: PASS.

- [ ] **Step 5: Echten DTD-Download ausführen** (einmalig, groß)

Run: `ml/.venv/Scripts/python.exe -m ml.download_backgrounds`
Expected: `backgrounds ready: <mehrere tausend> images`. Falls die Uni-Oxford-URL nicht erreichbar ist: im README notieren, dass `list_backgrounds` mit *jedem* Bilderordner funktioniert — Nutzer kann alternativ einen eigenen Ordner nach `ml/data/backgrounds/` legen.

- [ ] **Step 6: Commit**

```bash
git add ml/download_backgrounds.py ml/tests/test_download_backgrounds.py
git commit -m "feat(ml): DTD background downloader + extractor"
```

---

### Task 4: Augmentierungs-Primitive

**Files:**
- Create: `ml/augment.py`
- Test: `ml/tests/test_augment.py`

**Interfaces:**
- Consumes: nichts (nur cv2/numpy).
- Produces:
  - `perspective_warp(rgba: np.ndarray, rng: np.random.Generator, max_warp: float = 0.25) -> tuple[np.ndarray, np.ndarray]` — gibt (gewarptes BGRA-Bild auf enger Leinwand, `quad` = 4 Zielecken float32 (4,2) relativ zur Leinwand) zurück.
  - `jitter_lighting(bgr: np.ndarray, rng) -> np.ndarray`.
  - `add_foil_glare(bgr: np.ndarray, rng) -> np.ndarray`.
  - `add_blur_noise(bgr: np.ndarray, rng) -> np.ndarray`.

- [ ] **Step 1: Failing test schreiben** — `ml/tests/test_augment.py`

```python
import numpy as np
from ml import augment


def _rng():
    return np.random.default_rng(0)


def test_perspective_warp_shapes():
    card = np.full((100, 70, 4), 255, dtype=np.uint8)
    warped, quad = augment.perspective_warp(card, _rng())
    assert warped.ndim == 3 and warped.shape[2] == 4
    assert quad.shape == (4, 2)
    # Ecken liegen innerhalb der Leinwand
    assert quad[:, 0].min() >= -0.5 and quad[:, 0].max() <= warped.shape[1] + 0.5
    assert quad[:, 1].min() >= -0.5 and quad[:, 1].max() <= warped.shape[0] + 0.5


def test_foil_glare_brightens():
    img = np.full((50, 50, 3), 100, dtype=np.uint8)
    out = augment.add_foil_glare(img, _rng())
    assert out.shape == img.shape
    assert out.mean() > img.mean()  # Glanz hellt auf


def test_jitter_is_deterministic_with_seed():
    img = np.full((20, 20, 3), 120, dtype=np.uint8)
    a = augment.jitter_lighting(img, np.random.default_rng(7))
    b = augment.jitter_lighting(img, np.random.default_rng(7))
    assert np.array_equal(a, b)
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_augment.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Minimale Implementierung** — `ml/augment.py`

```python
import cv2
import numpy as np


def perspective_warp(rgba: np.ndarray, rng: np.random.Generator, max_warp: float = 0.25):
    h, w = rgba.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jitter = max_warp * np.array([w, h], dtype=np.float32)
    dst = src + rng.uniform(-1.0, 1.0, size=(4, 2)).astype(np.float32) * jitter
    dst -= dst.min(axis=0)  # in den positiven Bereich schieben
    out_w = int(np.ceil(dst[:, 0].max())) + 1
    out_h = int(np.ceil(dst[:, 1].max())) + 1
    m = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        rgba, m, (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return warped, dst


def jitter_lighting(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    alpha = float(rng.uniform(0.6, 1.4))   # Kontrast
    beta = float(rng.uniform(-40, 40))     # Helligkeit
    return cv2.convertScaleAbs(bgr, alpha=alpha, beta=beta)


def add_foil_glare(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    h, w = bgr.shape[:2]
    angle = float(rng.uniform(0, np.pi))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = xx * np.cos(angle) + yy * np.sin(angle)
    span = float(proj.max() - proj.min()) + 1e-6
    proj = (proj - proj.min()) / span
    center = float(rng.uniform(0.2, 0.8))
    width = float(rng.uniform(0.05, 0.2))
    streak = np.exp(-((proj - center) ** 2) / (2 * width ** 2))
    intensity = float(rng.uniform(40, 120))
    glare = (streak * intensity)[..., None]
    return np.clip(bgr.astype(np.float32) + glare, 0, 255).astype(np.uint8)


def add_blur_noise(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = bgr
    if rng.random() < 0.5:
        k = int(rng.choice([3, 5]))
        out = cv2.GaussianBlur(out, (k, k), 0)
    if rng.random() < 0.5:
        sigma = float(rng.uniform(2, 12))
        noise = rng.normal(0, sigma, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return out
```

- [ ] **Step 4: Test laufen lassen (muss grün sein)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_augment.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/augment.py ml/tests/test_augment.py
git commit -m "feat(ml): augmentation primitives (warp, lighting, foil glare, blur/noise)"
```

---

### Task 5: Szenen-Komposition

**Files:**
- Create: `ml/compose_scene.py`
- Test: `ml/tests/test_compose_scene.py`

**Interfaces:**
- Consumes: `ml.augment`, `ml.config`.
- Produces:
  - `load_art_bgr(path) -> np.ndarray` (BGR, wirft bei Lesefehler).
  - `augment_card(art_bgr, rng) -> tuple[np.ndarray, np.ndarray]` — (gewarptes BGRA, quad (4,2)).
  - `augment_crop(art_bgr, rng, size=config.CROP_SIZE) -> np.ndarray` — 224×224 BGR, augmentiert, für den Embedder.
  - `compose_scene(background_bgr, arts, rng, size=config.SCENE_SIZE) -> tuple[np.ndarray, list]` — `arts` = Liste `(passcode:int, art_bgr)`, Rückgabe (Szene-BGR, Boxen), Box = `(passcode:int, quad_in_scene float32 (4,2))`.
  - `quad_to_yolo(quad, size) -> tuple[float, float, float, float]` — `(cx, cy, w, h)` normalisiert in [0,1].

- [ ] **Step 1: Failing test schreiben** — `ml/tests/test_compose_scene.py`

```python
import numpy as np
from ml import compose_scene, config


def test_compose_returns_one_box_per_card():
    rng = np.random.default_rng(0)
    bg = np.full((300, 300, 3), 50, dtype=np.uint8)
    arts = [
        (111, np.full((120, 80, 3), 200, dtype=np.uint8)),
        (222, np.full((120, 80, 3), 150, dtype=np.uint8)),
    ]
    scene, boxes = compose_scene.compose_scene(bg, arts, rng)
    assert scene.shape == (config.SCENE_SIZE, config.SCENE_SIZE, 3)
    assert len(boxes) == 2
    assert {b[0] for b in boxes} == {111, 222}


def test_quad_to_yolo_normalised():
    quad = np.float32([[100, 100], [300, 100], [300, 500], [100, 500]])
    cx, cy, w, h = compose_scene.quad_to_yolo(quad, size=640)
    for v in (cx, cy, w, h):
        assert 0.0 <= v <= 1.0
    assert abs(cx - (200 / 640)) < 1e-6
    assert abs(h - (400 / 640)) < 1e-6


def test_augment_crop_size():
    rng = np.random.default_rng(1)
    art = np.full((120, 80, 3), 180, dtype=np.uint8)
    crop = compose_scene.augment_crop(art, rng)
    assert crop.shape == (config.CROP_SIZE, config.CROP_SIZE, 3)
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_compose_scene.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Minimale Implementierung** — `ml/compose_scene.py`

```python
import cv2
import numpy as np

from ml import augment, config


def load_art_bgr(path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"cannot read image: {path}")
    return img


def _paste_rgba(scene: np.ndarray, patch: np.ndarray, ox: int, oy: int) -> None:
    h, w = patch.shape[:2]
    H, W = scene.shape[:2]
    x0, y0 = max(ox, 0), max(oy, 0)
    x1, y1 = min(ox + w, W), min(oy + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    sub = patch[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    alpha = sub[:, :, 3:4].astype(np.float32) / 255.0
    region = scene[y0:y1, x0:x1].astype(np.float32)
    blended = alpha * sub[:, :, :3].astype(np.float32) + (1 - alpha) * region
    scene[y0:y1, x0:x1] = blended.astype(np.uint8)


def augment_card(art_bgr, rng):
    x = augment.jitter_lighting(art_bgr, rng)
    if rng.random() < 0.7:
        x = augment.add_foil_glare(x, rng)
    x = augment.add_blur_noise(x, rng)
    bgra = cv2.cvtColor(x, cv2.COLOR_BGR2BGRA)
    return augment.perspective_warp(bgra, rng)


def augment_crop(art_bgr, rng, size: int = config.CROP_SIZE) -> np.ndarray:
    warped, _ = augment_card(art_bgr, rng)          # BGRA mit transparentem Rand
    h, w = warped.shape[:2]
    side = max(h, w)
    canvas = np.full((side, side, 3), 127, dtype=np.uint8)  # neutrales graues Quadrat (BGR)
    oy, ox = (side - h) // 2, (side - w) // 2
    _paste_rgba(canvas, warped, ox, oy)             # BGR-Szene + BGRA-Patch → alpha-Blend
    return cv2.resize(canvas, (size, size))


def compose_scene(background_bgr, arts, rng, size: int = config.SCENE_SIZE):
    scene = cv2.resize(background_bgr, (size, size))
    boxes = []
    for passcode, art_bgr in arts:
        warped, quad = augment_card(art_bgr, rng)
        ch, cw = warped.shape[:2]
        scale = float(rng.uniform(0.15, 0.45)) * size / max(ch, cw)
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
        warped = cv2.resize(warped, (nw, nh))
        quad = quad * scale
        ox = int(rng.uniform(-0.1 * nw, size - 0.9 * nw))
        oy = int(rng.uniform(-0.1 * nh, size - 0.9 * nh))
        _paste_rgba(scene, warped, ox, oy)
        boxes.append((passcode, (quad + np.float32([ox, oy])).astype(np.float32)))
    return scene, boxes


def quad_to_yolo(quad, size: int):
    xs = np.clip(quad[:, 0], 0, size)
    ys = np.clip(quad[:, 1], 0, size)
    x0, x1 = float(xs.min()), float(xs.max())
    y0, y1 = float(ys.min()), float(ys.max())
    cx = (x0 + x1) / 2 / size
    cy = (y0 + y1) / 2 / size
    bw = (x1 - x0) / size
    bh = (y1 - y0) / size
    return cx, cy, bw, bh
```

> **Hinweis:** `_paste_rgba` erwartet eine **BGR**-Szene und einen **BGRA**-Patch — deshalb ist `canvas` in `augment_crop` 3-kanalig; die Transparenz kommt aus `warped`.

- [ ] **Step 4: Test laufen lassen (muss grün sein)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_compose_scene.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/compose_scene.py ml/tests/test_compose_scene.py
git commit -m "feat(ml): scene composition + YOLO boxes + embedder crop augmentation"
```

---

### Task 6: Generator-CLI + Phasen-Gate

**Files:**
- Create: `ml/generate.py`
- Test: `ml/tests/test_generate.py`

**Interfaces:**
- Consumes: `ml.config`, `ml.compose_scene`, `ml.download_backgrounds.list_backgrounds`.
- Produces:
  - `load_card_manifest(cards_dir=config.CARDS_DIR) -> list[tuple[int, Path]]` — `(passcode, jpg_path)` nur für existierende Dateien.
  - `write_yolo_label(path, boxes, size) -> None` — eine Zeile je Box: `0 cx cy w h`.
  - `draw_boxes(scene, boxes, size) -> np.ndarray` — Debug-Overlay (Rechtecke) für die Sichtprüfung.
  - `generate_detection_set(n_scenes, seed=0, val_split=0.1) -> None` — schreibt `DET_DIR/{images,labels}/{train,val}/`.
  - `main()` — CLI (`--scenes`, `--seed`, `--debug`).

- [ ] **Step 1: Failing test schreiben** — `ml/tests/test_generate.py`

```python
import cv2
import numpy as np
from ml import generate, config


def test_generate_detection_set_writes_pairs(tmp_path, monkeypatch):
    # Karten-Manifest, Hintergrund-Liste und Bild-Loader durch Fakes ersetzen
    monkeypatch.setattr(generate, "load_card_manifest",
                        lambda *a, **k: [(111, "c1"), (222, "c2")])
    monkeypatch.setattr(generate, "list_backgrounds", lambda *a, **k: ["bg"])
    monkeypatch.setattr(generate.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    monkeypatch.setattr(config, "DET_DIR", tmp_path)

    generate.generate_detection_set(n_scenes=3, seed=0, val_split=0.0)

    imgs = sorted((tmp_path / "images" / "train").glob("*.jpg"))
    lbls = sorted((tmp_path / "labels" / "train").glob("*.txt"))
    assert len(imgs) == 3 and len(lbls) == 3
    # Label-Zeilen: 5 Felder, Klasse 0, Werte in [0,1]
    for line in lbls[0].read_text().strip().splitlines():
        parts = line.split()
        assert len(parts) == 5 and parts[0] == "0"
        assert all(0.0 <= float(v) <= 1.0 for v in parts[1:])
```

- [ ] **Step 2: Test laufen lassen (muss fehlschlagen)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_generate.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Minimale Implementierung** — `ml/generate.py`

```python
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from ml import config, compose_scene
from ml.download_backgrounds import list_backgrounds


def load_card_manifest(cards_dir: Path = config.CARDS_DIR) -> list[tuple[int, Path]]:
    manifest = json.loads((cards_dir / "manifest.json").read_text())
    items: list[tuple[int, Path]] = []
    for e in manifest:
        p = cards_dir / f"{e['artwork_id']}.jpg"
        if p.exists():
            items.append((int(e["passcode"]), p))
    return items


def write_yolo_label(path: Path, boxes, size: int) -> None:
    lines = []
    for _passcode, quad in boxes:
        cx, cy, w, h = compose_scene.quad_to_yolo(quad, size)
        if w <= 0 or h <= 0:
            continue
        lines.append(f"{config.CARD_CLASS} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    path.write_text("\n".join(lines))


def draw_boxes(scene: np.ndarray, boxes, size: int) -> np.ndarray:
    out = scene.copy()
    for _passcode, quad in boxes:
        cx, cy, w, h = compose_scene.quad_to_yolo(quad, size)
        x0 = int((cx - w / 2) * size); y0 = int((cy - h / 2) * size)
        x1 = int((cx + w / 2) * size); y1 = int((cy + h / 2) * size)
        cv2.rectangle(out, (x0, y0), (x1, y1), (0, 255, 0), 2)
    return out


def generate_detection_set(n_scenes: int, seed: int = 0, val_split: float = 0.1, debug: bool = False) -> None:
    rng = np.random.default_rng(seed)
    cards = load_card_manifest()
    backgrounds = list_backgrounds()
    if not cards or not backgrounds:
        raise RuntimeError("Karten- oder Hintergrund-Daten fehlen — erst Task 2 & 3 ausführen.")

    for split in ("train", "val"):
        (config.DET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (config.DET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    for i in range(n_scenes):
        split = "val" if rng.random() < val_split else "train"
        k = int(rng.integers(1, 9))  # 1..8 Karten
        idx = rng.integers(0, len(cards), size=k)
        arts = [(cards[j][0], compose_scene.load_art_bgr(cards[j][1])) for j in idx]
        bg = compose_scene.load_art_bgr(backgrounds[int(rng.integers(0, len(backgrounds)))])
        scene, boxes = compose_scene.compose_scene(bg, arts, rng)

        stem = f"scene_{i:06d}"
        cv2.imwrite(str(config.DET_DIR / "images" / split / f"{stem}.jpg"), scene)
        write_yolo_label(config.DET_DIR / "labels" / split / f"{stem}.txt", boxes, config.SCENE_SIZE)
        if debug:
            dbg = config.DET_DIR / "debug"; dbg.mkdir(exist_ok=True)
            cv2.imwrite(str(dbg / f"{stem}.jpg"), draw_boxes(scene, boxes, config.SCENE_SIZE))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenes", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    generate_detection_set(args.scenes, seed=args.seed, debug=args.debug)
    print(f"generated {args.scenes} scenes into {config.DET_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test laufen lassen (muss grün sein)**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/tests/test_generate.py -v`
Expected: PASS.

- [ ] **Step 5: Gesamte Testsuite grün**

Run: `ml/.venv/Scripts/python.exe -m pytest ml/ -v`
Expected: alle Tests PASS.

- [ ] **Step 6: PHASEN-GATE — Sicht-Verifikation der synthetischen Daten**

Voraussetzung: Task 2 (`--limit` reicht nicht — für echte Vielfalt vorher vollen Karten-Download laufen lassen, oder mind. ~200 Karten) und Task 3 (DTD) ausgeführt.

Run: `ml/.venv/Scripts/python.exe -m ml.generate --scenes 20 --debug`
Dann `ml/data/out/detect/debug/*.jpg` öffnen und prüfen:
- Karten sichtbar auf realen Texturen, mit Perspektive/Glanz/Unschärfe/Überlappung.
- Grüne Boxen umschließen jede Karte eng und korrekt.
- Auch bei Überlappung ist jede Karte gelabelt.

Zusätzlich ein paar `augment_crop`-Beispiele erzeugen und ansehen (kurzes Ad-hoc-Snippet im README dokumentiert), um die Embedder-Augmentierung plausibel zu bestätigen.

Dies ist das Abnahmekriterium aus dem Master-Spec für Phase 1 („Szenen+Labels und augmentierte Arts plausibel").

- [ ] **Step 7: Commit**

```bash
git add ml/generate.py ml/tests/test_generate.py
git commit -m "feat(ml): synthetic detection-set generator + debug overlay (phase 1 gate)"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Abdeckung (Phase 1 = „Bulk-Download + Synthese-Generator"):**
- Bulk-Download Karten → Task 2. ✅
- Hintergründe (DTD-Entscheidung) → Task 3. ✅
- Synthese-Generator mit Perspektive/Licht/Foil-Glanz/Unschärfe/Überlappung → Tasks 4+5. ✅
- Detector-Szenen mit Boxen (YOLO) → Tasks 5+6. ✅
- Embedder-Augmentierung (`augment_crop`) → Task 5. ✅
- Verify „plausibel" → Task 6 Gate (Debug-Overlay). ✅

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt vollständig und lauffähig.

**Typ-Konsistenz:** `perspective_warp → (warped, quad)`; `compose_scene → (scene, boxes)` mit `boxes=[(passcode, quad)]`; `quad_to_yolo(quad, size) → (cx,cy,w,h)`; in `write_yolo_label`/`draw_boxes` identisch konsumiert. `list_backgrounds`/`load_card_manifest`-Signaturen über Tasks stabil.

---

## Offen für spätere Phasen (bewusst NICHT in Phase 1)
- Embedder-Training + Desktop-Index (Phase 2), Detector-Training (Phase 3) — brauchen GPU + PyTorch (3.14-Kompatibilität dann prüfen).
- Modell-Input-Auflösungen final fixieren, sobald Architektur steht (Vertrag A↔B↔C).
- Pendulum/Full-Art-Sonderrahmen: Crop-Geometrie in Phase 6 verfeinern.
