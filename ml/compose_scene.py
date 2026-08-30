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
