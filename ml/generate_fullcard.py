"""YOLO-Datensatz mit ganzen Karten erzeugen (Spec 2026-09-17, Teil D-2).

Mischung je Szene: ~70 % ganze Karten, ~20 % nackte Artworks (bisheriges Verhalten), ~10 % ohne Karte.
    python -m ml.generate_fullcard --scenes 20000 --out ml/data/out/detect_v2 [--debug 50]
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from ml import compose_fullcard, compose_scene, config
from ml.download_backgrounds import list_backgrounds
from ml.generate import draw_boxes, write_yolo_label

FULL = config.DATA_DIR / "full_cards"
WINDOWS = config.DATA_DIR / "artwork_window.json"


def load_full_cards():
    windows = json.loads(WINDOWS.read_text())
    out = []
    for e in json.loads((FULL / "manifest.json").read_text()):
        rel = windows.get(e["frame_type"])
        p = FULL / f"{e['artwork_id']}.jpg"
        if rel and p.exists():
            out.append((e["passcode"], p, rel["rel"], "pendulum" in e["frame_type"]))
    return out


def load_arts():
    out = []
    for e in json.loads((config.CARDS_DIR / "manifest.json").read_text()):
        p = config.CARDS_DIR / f"{e['artwork_id']}.jpg"
        if p.exists():
            out.append((e["passcode"], p))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=str(config.OUT_DIR / "detect_v2"))
    ap.add_argument("--debug", type=int, default=0, help="so viele Szenen zusaetzlich mit Boxen zeichnen")
    ap.add_argument("--val", type=float, default=0.1)
    ap.add_argument("--pendulum-share", type=float, default=0.0,
                    help="Anteil der ganzen Karten, die aus Pendel-Karten gezogen werden (Uebergewicht)")
    a = ap.parse_args()
    out = Path(a.out)
    rng = np.random.default_rng(a.seed)
    full, arts, bgs = load_full_cards(), load_arts(), list_backgrounds()
    pend = [c for c in full if c[3]]
    if not full or not arts or not bgs:
        raise RuntimeError(f"Daten fehlen: ganze Karten={len(full)} Artworks={len(arts)} Hintergruende={len(bgs)}")
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    for i in range(a.scenes):
        split = "val" if rng.random() < a.val else "train"
        u = rng.random()
        items = []
        if u < 0.7:
            for _ in range(int(rng.integers(1, 5))):
                pool = pend if pend and rng.random() < a.pendulum_share else full
                pc, p, rel, _p = pool[int(rng.integers(0, len(pool)))]
                items.append((pc, compose_scene.load_art_bgr(p), rel, 0.25, 0.95))
        elif u < 0.9:
            for j in rng.integers(0, len(arts), size=int(rng.integers(1, 9))):
                pc, p = arts[j]
                items.append((pc, compose_scene.load_art_bgr(p), None, 0.15, 0.45))
        bg = compose_scene.load_art_bgr(bgs[int(rng.integers(0, len(bgs)))])
        scene, boxes = compose_fullcard.compose(bg, items, rng, config.SCENE_SIZE)
        stem = f"v2_{i:06d}"
        cv2.imwrite(str(out / "images" / split / f"{stem}.jpg"), scene)
        write_yolo_label(out / "labels" / split / f"{stem}.txt", boxes, config.SCENE_SIZE)
        if i < a.debug:
            (out / "debug").mkdir(exist_ok=True)
            cv2.imwrite(str(out / "debug" / f"{stem}.jpg"), draw_boxes(scene, boxes, config.SCENE_SIZE))
        if (i + 1) % 1000 == 0:
            print(f"{i + 1}/{a.scenes}", flush=True)
    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: card\n")


if __name__ == "__main__":
    main()
