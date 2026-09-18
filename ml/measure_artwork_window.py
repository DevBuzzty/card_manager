"""Artwork-Fenster im ganzen Kartenbild je frameType vermessen (Spec 2026-09-17, Teil D-2).

Fuer eine Stichprobe je frameType wird das ausgeschnittene Artwork (ml/data/cards/<id>.jpg) per
mehrskaliger Schablonensuche im ganzen Kartenbild (ml/data/full_cards/<id>.jpg) gefunden. Ergebnis:
Median-Rechteck relativ zur Karte (l, t, r, b) -> ml/data/artwork_window.json. Diese Rechtecke sind die
Box-Labels fuer die Szenen mit ganzen Karten.
"""
import json
import random
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from ml import config

FULL = config.DATA_DIR / "full_cards"
OUT = config.DATA_DIR / "artwork_window.json"


def locate(full: np.ndarray, art: np.ndarray):
    H, W = full.shape[:2]
    best = (-1.0, None)
    ah, aw = art.shape[:2]
    for frac in np.arange(0.60, 0.97, 0.01):
        w = int(W * frac)
        h = int(round(ah * w / aw))
        if h >= H or w >= W:
            continue
        t = cv2.resize(art, (w, h), interpolation=cv2.INTER_AREA)
        r = cv2.matchTemplate(full, t, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(r)
        if mx > best[0]:
            best = (mx, (loc[0] / W, loc[1] / H, (loc[0] + w) / W, (loc[1] + h) / H))
    return best


def locate_pendulum(full: np.ndarray, art: np.ndarray):
    """Pendel: das Artwork liegt zum Teil HINTER dem Pendel-Textfeld, die ganze Schablone passt also
    nicht. Das obere Band (30 %) sucht Lage und Massstab, das sichtbare Fenster endet dort, wo die
    Zeilen nicht mehr zum Artwork passen (Oberkante Pendel-Textfeld)."""
    H, W = full.shape[:2]
    ah, aw = art.shape[:2]
    band = art[: int(0.3 * ah)]
    best = (-1.0, None)
    for frac in np.arange(0.80, 0.96, 0.005):
        w = int(W * frac)
        s = w / aw
        t = cv2.resize(band, (w, int(band.shape[0] * s)), interpolation=cv2.INTER_AREA)
        if t.shape[0] >= H:
            continue
        r = cv2.matchTemplate(full, t, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(r)
        if mx > best[0]:
            best = (mx, (loc, s, w))
    score, found = best
    if found is None:
        return score, None
    (x0, y0), s, w = found
    big = cv2.resize(art, (w, int(ah * s)))
    for y in range(int(0.4 * big.shape[0]), big.shape[0]):
        if y0 + y >= H:
            break
        if np.mean(np.abs(big[y].astype(float) - full[y0 + y, x0:x0 + w].astype(float))) > 35:
            return score, (x0 / W, y0 / H, (x0 + w) / W, (y0 + y) / H)
    return score, None


def main(per_type: int = 40, seed: int = 0) -> None:
    entries = json.loads((FULL / "manifest.json").read_text())
    by = defaultdict(list)
    for e in entries:
        if (FULL / f"{e['artwork_id']}.jpg").exists() and (config.CARDS_DIR / f"{e['artwork_id']}.jpg").exists():
            by[e["frame_type"]].append(e)
    rng = random.Random(seed)
    result = {}
    for ft, es in sorted(by.items()):
        rects = []
        for e in rng.sample(es, min(per_type, len(es))):
            full = cv2.imread(str(FULL / f"{e['artwork_id']}.jpg"), cv2.IMREAD_GRAYSCALE)
            art = cv2.imread(str(config.CARDS_DIR / f"{e['artwork_id']}.jpg"), cv2.IMREAD_GRAYSCALE)
            if full is None or art is None:
                continue
            score, rect = (locate_pendulum if "pendulum" in ft else locate)(full, art)
            if score >= 0.8 and rect is not None:
                rects.append(rect)
        if len(rects) < 5:
            print(f"{ft:16s} zu wenige Treffer ({len(rects)}) -- uebersprungen")
            continue
        a = np.array(rects)
        med = np.median(a, axis=0)
        spread = np.percentile(a, 90, axis=0) - np.percentile(a, 10, axis=0)
        result[ft] = {"rel": [round(float(v), 4) for v in med], "n": len(rects),
                      "streuung_p10_p90": [round(float(v), 4) for v in spread]}
        print(f"{ft:16s} n={len(rects):3d} rel={result[ft]['rel']} streuung={result[ft]['streuung_p10_p90']}")
    OUT.write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
