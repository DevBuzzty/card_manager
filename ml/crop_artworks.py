#!/usr/bin/env python
"""Extract the artwork crop from each real (whole-card) harvest photo, using the trained
detector — so the fine-tuning input matches inference (detector -> artwork-crop -> embed).

eBay listing photos are frame-filling whole cards; the detector was trained on artwork
patches that are SMALL in a 640 scene, so a frame-filling card is out-of-distribution.
Fix: scale-sweep — render the photo at a few sizes on a gray canvas (mimicking scene scale),
detect at each, keep the highest-scoring box that passes an aspect/area filter (rejects the
small holo-sticker / rarity-stamp false hits). Drop photos where nothing valid is found.

    python ml/crop_artworks.py
In : ml/data/harvest/labeled/<passcode>/<file>.jpg   (from label_photos reconstruction)
Out: ml/data/harvest/labeled_crops/<passcode>/<file>.jpg   (224x224 artwork crops)
     ml/data/harvest/labeled_crops/crops_manifest.json      [{file, passcode, score}]
"""
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

HARV = Path(__file__).resolve().parent / "data" / "harvest"
LABELED = HARV / "labeled"
OUT = HARV / "labeled_crops"
DETECTOR = Path(__file__).resolve().parent.parent / "android/app/src/main/assets/detector.onnx"
SCALES = (0.40, 0.55, 0.70)   # card long-side as fraction of the 640 frame
MIN_SCORE = 0.15
CROP = 224

_sess = None


def sess():
    global _sess
    if _sess is None:
        _sess = ort.InferenceSession(str(DETECTOR))
    return _sess


def _sceneify(img, f, s=640, pad=114):
    h, w = img.shape[:2]
    r = (f * s) / max(h, w)
    nh, nw = int(h * r), int(w * r)
    canvas = np.full((s, s, 3), pad, np.uint8)
    top, left = (s - nh) // 2, (s - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh))
    return canvas, r, left, top


def _pad_sq(bgr, fill=127):
    h, w = bgr.shape[:2]
    side = max(h, w)
    c = np.full((side, side, 3), fill, np.uint8)
    c[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = bgr
    return c


def best_crop(path):
    """Return (224x224 BGR artwork crop, score) or (None, best_rejected_score)."""
    img = cv2.imread(str(path))
    if img is None:
        return None, 0.0
    H, W = img.shape[:2]
    best, best_score = None, 0.0
    for f in SCALES:
        canvas, r, left, top = _sceneify(img, f)
        inp = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        out = sess().run(None, {"images": inp.transpose(2, 0, 1)[None]})[0][0]
        for x1, y1, x2, y2, score, _ in out:
            if score < MIN_SCORE:
                continue
            ox1, oy1 = (x1 - left) / r, (y1 - top) / r
            ox2, oy2 = (x2 - left) / r, (y2 - top) / r
            bw, bh = ox2 - ox1, oy2 - oy1
            if bw <= 0 or bh <= 0:
                continue
            # artwork is roughly square and a big chunk of the card; small holo stickers fail this
            if not (0.6 < bw / bh < 1.7 and (bw * bh) / (W * H) > 0.10):
                continue
            if score > best_score:
                best_score = float(score)
                best = (int(max(0, ox1)), int(max(0, oy1)), int(min(W, ox2)), int(min(H, oy2)))
    if best is None:
        return None, best_score
    x1, y1, x2, y2 = best
    if x2 <= x1 or y2 <= y1:
        return None, best_score
    return cv2.resize(_pad_sq(img[y1:y2, x1:x2]), (CROP, CROP)), best_score


def main():
    OUT.mkdir(exist_ok=True)
    files = sorted(p for p in LABELED.rglob("*.jpg") if OUT not in p.parents)
    manifest, kept, dropped = [], 0, 0
    for i, p in enumerate(files, 1):
        pc = p.parent.name
        crop, score = best_crop(p)
        if crop is None:
            dropped += 1
        else:
            d = OUT / pc
            d.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(d / p.name), crop)
            manifest.append({"file": f"{pc}/{p.name}", "passcode": pc, "score": round(score, 3)})
            kept += 1
        if i % 500 == 0:
            (OUT / "crops_manifest.json").write_text(json.dumps(manifest, indent=1))
            print(f"  {i}/{len(files)} | kept {kept} drop {dropped}")
    (OUT / "crops_manifest.json").write_text(json.dumps(manifest, indent=1))
    cards = len({m["passcode"] for m in manifest})
    print(f"\nCROPPED: kept {kept}, dropped {dropped} ({kept/len(files)*100:.0f}%) "
          f"over {cards} cards -> {OUT}")


if __name__ == "__main__":
    main()
