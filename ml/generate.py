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


def generate_detection_set(n_scenes: int, seed: int = 0, val_split: float = 0.1,
                           debug: bool = False, bg_fraction: float = 0.0) -> None:
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
        if rng.random() < bg_fraction:
            arts = []  # card-less negative scene: teaches the detector "no card here"
        else:
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
    parser.add_argument("--bg-fraction", type=float, default=0.0,
                        help="fraction of card-less negative scenes (reduces false positives)")
    args = parser.parse_args()
    generate_detection_set(args.scenes, seed=args.seed, debug=args.debug, bg_fraction=args.bg_fraction)
    print(f"generated {args.scenes} scenes into {config.DET_DIR}")


if __name__ == "__main__":
    main()
