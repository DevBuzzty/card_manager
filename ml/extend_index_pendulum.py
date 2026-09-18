"""index.bin um den SICHTBAREN Bildteil der Pendel-Karten erweitern (18.09.2026).

Der Index enthaelt je Karte das ganze Artwork (`image_url_cropped`). Bei Pendel-Karten liegt die untere
Haelfte davon hinter dem Pendel-Textfeld; der Detektor boxt nur das sichtbare Fenster (Seitenverhaeltnis
~1,36), und der Embedder traf die Karte damit nur mit sim 0,44-0,69 (Schwelle 0,6). Je Pendel-Artwork
kommt deshalb ein zweiter Eintrag hinzu: der obere Teil mit Seitenverhaeltnis 1,36, gleicher Passcode.
Messkorb: Pendel-Fotos 27,9 -> 90,7 %, uebrige Koerbe unveraendert oder besser.

    python -m ml.extend_index_pendulum --index android/app/src/main/assets/index.bin --out ml/data/index_pendel.bin
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from ml import config

ASPECT = 1.36
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    assets = root / "android" / "app" / "src" / "main" / "assets"
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=str(assets / "index.bin"))
    ap.add_argument("--embedder", default=str(assets / "embedder.onnx"))
    ap.add_argument("--out", default=str(config.DATA_DIR / "index_pendel.bin"))
    a = ap.parse_args()

    raw = Path(a.index).read_bytes()
    n, dim = struct.unpack_from("<II", raw, 0)
    emb_old = np.frombuffer(raw, "<f4", n * dim, 8).reshape(n, dim)
    pcs_old = np.frombuffer(raw, "<i4", n, 8 + n * dim * 4)
    sess = ort.InferenceSession(a.embedder)

    manifest = json.loads((config.DATA_DIR / "full_cards" / "manifest.json").read_text())
    new_e, new_p = [], []
    for e in manifest:
        art_path = config.CARDS_DIR / f"{e['artwork_id']}.jpg"
        if "pendulum" not in e["frame_type"] or not art_path.exists():
            continue
        art = Image.open(art_path).convert("RGB")
        top = art.crop((0, 0, art.width, min(art.height, int(round(art.width / ASPECT)))))
        side = max(top.size)
        sq = Image.new("RGB", (side, side), (127, 127, 127))
        sq.paste(top, ((side - top.width) // 2, (side - top.height) // 2))
        x = ((np.asarray(sq.resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
        q = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        new_e.append(q / np.linalg.norm(q))
        new_p.append(e["passcode"])

    emb = np.vstack([emb_old, np.array(new_e, np.float32)])
    pcs = np.concatenate([pcs_old, np.array(new_p, np.int32)])
    Path(a.out).write_bytes(struct.pack("<II", len(pcs), dim) + emb.astype("<f4").tobytes() + pcs.astype("<i4").tobytes())
    print(f"{a.out}: {n} + {len(new_p)} Pendel-Eintraege = {len(pcs)}")


if __name__ == "__main__":
    main()
