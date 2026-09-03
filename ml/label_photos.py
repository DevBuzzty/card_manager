#!/usr/bin/env python
"""OCR-label harvested photos by the 8-digit passcode PRINTED ON the card (ground truth).

Marketplace searches are noisy: a "Dark Magician" search also returns "Dark Paladin", bundles,
sleeves, wrong cards. This pass reads the passcode actually on each photo and RE-LABELS by it,
dropping photos where no valid passcode is legible. Result = clean (photo, passcode) pairs for
fine-tuning the embedder on the digital->photo domain gap.

Needs EasyOCR (runs where a GPU is handy — your PC or Kaggle):
    pip install easyocr opencv-python
Run after harvest_photos.py:
    python ml/label_photos.py
Output:
    ml/data/harvest/labeled/<passcode>/<file>.jpg
    ml/data/harvest/labeled/labeled_manifest.json   # [{file, passcode, from_search}]
"""
import json
import re
import shutil
import urllib.request
from pathlib import Path

import cv2  # opencv-python
import easyocr

HARVEST = Path(__file__).resolve().parent / "data" / "harvest"
OUT = HARVEST / "labeled"
PASS_RE = re.compile(r"\d{8}")

_reader = None
_valid_cache: dict[str, bool] = {}


def reader():
    global _reader
    if _reader is None:
        try:
            import torch
            gpu = torch.cuda.is_available()
        except Exception:
            gpu = False
        _reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)
    return _reader


def is_valid_passcode(pc: str) -> bool:
    """A real YGOPRODeck id? (filters phone numbers / prices that happen to be 8 digits)."""
    if pc in _valid_cache:
        return _valid_cache[pc]
    ok = False
    try:
        req = urllib.request.Request(
            "https://db.ygoprodeck.com/api/v7/cardinfo.php?id=" + pc,
            headers={"User-Agent": "harvest/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = b'"data"' in r.read(300)
    except Exception:
        ok = False
    _valid_cache[pc] = ok
    return ok


def _bottom_left(img):
    """3x-upscaled bottom-left strip, where the passcode is printed."""
    h, w = img.shape[:2]
    strip = img[int(h * 0.78):h, 0:int(w * 0.62)]
    if strip.size == 0:
        return None
    return cv2.resize(strip, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)


def read_passcode(path: Path):
    img = cv2.imread(str(path))
    if img is None:
        return None
    crops = [img]
    bl = _bottom_left(img)
    if bl is not None:
        crops.append(bl)
    for crop in crops:
        for _, text, _conf in reader().readtext(crop):
            for pc in PASS_RE.findall(text.replace(" ", "")):
                if is_valid_passcode(pc):
                    return pc
    return None


def main():
    OUT.mkdir(exist_ok=True)
    mpath = OUT / "labeled_manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else []
    done = {m["from_search"] + "/" + Path(m["file"]).name for m in manifest}  # resume: skip already-kept
    kept, dropped = len(manifest), 0
    for i, p in enumerate(sorted(HARVEST.rglob("*.jpg"))):
        if OUT in p.parents:
            continue
        if p.parent.name + "/" + p.name in done:
            continue
        try:
            pc = read_passcode(p)
        except Exception as e:
            dropped += 1
            print(f"  ERR   {p.parent.name}/{p.name} ({e})")
            continue
        if not pc:
            dropped += 1
            print(f"  drop  {p.parent.name}/{p.name} (no passcode)")
            continue
        d = OUT / pc
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy(p, d / p.name)
        manifest.append({"file": f"{pc}/{p.name}", "passcode": pc, "from_search": p.parent.name})
        kept += 1
        tag = "OK" if pc == p.parent.name else f"RELABEL (search was {p.parent.name})"
        print(f"  keep  {p.name} -> {pc}  {tag}")
        if kept % 200 == 0:  # crash-safe: flush periodically
            mpath.write_text(json.dumps(manifest, indent=1))
            print(f"  ... checkpoint {kept} kept (idx {i})")
    mpath.write_text(json.dumps(manifest, indent=1))
    print(f"\nLABELED: kept {kept}, dropped {dropped} -> {OUT}")


if __name__ == "__main__":
    main()
