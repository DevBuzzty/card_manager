"""Aus den Yugipedia-Kandidaten (ml/fetch_yugipedia_artworks.py) die wirklich NEUEN Artworks waehlen.

Neu = das Embedding liegt unter NEU_SIM zu jedem Index-Eintrag DERSELBEN Karte (sonst ist es nur eine
JP/EN-Fassung oder ein anderer Ausschnitt eines bekannten Bildes). Ergebnis:
  ml/extra_artworks.json  -- versionierte Liste [passcode, dateiname] (build_index haengt sie an)
    python -m ml.select_extra_artworks [--index android/app/src/main/assets/index.bin]
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from ml import config

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "android" / "app" / "src" / "main" / "assets"
ART = config.DATA_DIR / "yugipedia_art"
LIST = ROOT / "ml" / "extra_artworks.json"
NEU_SIM = 0.85
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def embed(sess, img: Image.Image) -> np.ndarray:
    img = img.convert("RGB")
    side = max(img.size)
    sq = Image.new("RGB", (side, side), (127, 127, 127))
    sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    x = ((np.asarray(sq.resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
    q = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    return q / np.linalg.norm(q)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=str(ASSETS / "index.bin"))
    a = ap.parse_args()
    raw = Path(a.index).read_bytes()
    n, dim = struct.unpack_from("<II", raw, 0)
    E = np.frombuffer(raw, "<f4", n * dim, 8).reshape(n, dim)
    P = np.frombuffer(raw, "<i4", n, 8 + n * dim * 4)
    rows_by_pc = {}
    for i, pc in enumerate(P):
        rows_by_pc.setdefault(int(pc), []).append(i)
    sess = ort.InferenceSession(str(ASSETS / "embedder.onnx"))
    chosen, stats = [], {"neu": 0, "bekannt": 0, "ohne_karte": 0}
    for p in sorted(ART.glob("*.png")):
        pc = int(p.stem.split("__")[0])
        rows = rows_by_pc.get(pc)
        if not rows:
            stats["ohne_karte"] += 1
            continue
        q = embed(sess, Image.open(p))
        if float(np.max(E[rows] @ q)) < NEU_SIM:
            chosen.append([pc, p.name])
            stats["neu"] += 1
        else:
            stats["bekannt"] += 1
    LIST.write_text(json.dumps(chosen, indent=0))
    print(stats, "->", LIST)


if __name__ == "__main__":
    main()
