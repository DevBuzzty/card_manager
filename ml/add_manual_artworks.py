"""Manuelle Artworks (ml/manual_artworks/<passcode>_*.jpg) an ein SCHON GEBAUTES index.bin haengen.

Neu gebaute Indizes brauchen das nicht: ml/build_index.build_index haengt sie selbst an. Ein Eintrag je
Ausschnitt; mehrere Ausschnitte derselben Karte (verschiedene Fotos) machen die Erkennung robuster.
    python -m ml.add_manual_artworks --index android/app/src/main/assets/index.bin --out android/app/src/main/assets/index.bin
"""
import argparse
import struct
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from ml.build_index import manual_items

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def main() -> None:
    assets = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "assets"
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=str(assets / "index.bin"))
    ap.add_argument("--embedder", default=str(assets / "embedder.onnx"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    raw = Path(a.index).read_bytes()
    n, dim = struct.unpack_from("<II", raw, 0)
    emb = np.frombuffer(raw, "<f4", n * dim, 8).reshape(n, dim)
    pcs = np.frombuffer(raw, "<i4", n, 8 + n * dim * 4)
    sess = ort.InferenceSession(a.embedder)
    new_e, new_p = [], []
    for pc, path in manual_items():
        c = Image.open(path).convert("RGB")
        side = max(c.size)
        sq = Image.new("RGB", (side, side), (127, 127, 127))
        sq.paste(c, ((side - c.width) // 2, (side - c.height) // 2))
        x = ((np.asarray(sq.resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
        q = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        new_e.append(q / np.linalg.norm(q))
        new_p.append(pc)
    if not new_p:
        raise SystemExit("keine manuellen Artworks gefunden")
    out_e = np.vstack([emb, np.array(new_e, np.float32)])
    out_p = np.concatenate([pcs, np.array(new_p, np.int32)])
    Path(a.out).write_bytes(struct.pack("<II", len(out_p), dim) + out_e.astype("<f4").tobytes() + out_p.astype("<i4").tobytes())
    print(f"{a.out}: {n} + {len(new_p)} manuelle Eintraege = {len(out_p)}")


if __name__ == "__main__":
    main()
