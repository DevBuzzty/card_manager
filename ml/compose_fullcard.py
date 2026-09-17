"""Szenen mit GANZEN Karten fuer das Detektor-Neutraining (Spec 2026-09-17, Teil D-2).

Anders als compose_scene.compose_scene (nackte Artworks) wird hier das ganze Kartenbild eingeklebt; die
Box ist weiterhin das Artwork-Fenster, berechnet aus der vermessenen Rahmen-Geometrie
(ml/data/artwork_window.json) und durch DIESELBE Perspektive transformiert wie die Karte. Dazu:
versetzte Stapel (wie in der Stapel-Halterung), grosse Karten bis ~95 % Szenenhoehe, Finger-Verdeckung,
und Sichtbarkeitspruefung: ein Fenster, das spaeter eingeklebte Karten zu mehr als 40 % verdecken,
bekommt kein Label.
"""
import cv2
import numpy as np

from ml import augment, compose_scene

MIN_VISIBLE = 0.6


def warp_window(w: int, h: int, quad: np.ndarray, rel) -> np.ndarray:
    """Artwork-Fenster [l,t,r,b] (relativ zur Karte w x h) mit der Perspektive Karte->quad abbilden."""
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    m = cv2.getPerspectiveTransform(src, quad.astype(np.float32))
    l, t, r, b = rel
    pts = np.float32([[l * w, t * h], [r * w, t * h], [r * w, b * h], [l * w, b * h]]).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, m).reshape(4, 2)


def _poly_mask(size: int, quad: np.ndarray) -> np.ndarray:
    mask = np.zeros((size, size), np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 1)
    return mask


def _augment(bgr, rng):
    """Wie compose_scene.augment_card, liefert zusaetzlich die Kartengroesse vor dem Warp."""
    h, w = bgr.shape[:2]
    warped, quad = compose_scene.augment_card(bgr, rng)
    return warped, quad, w, h


def _finger(scene: np.ndarray, rng) -> None:
    """Hautfarbene Ellipse vom Bildrand her (Hand/Finger am Kartenrand)."""
    size = scene.shape[0]
    side = int(rng.integers(0, 4))
    along = float(rng.uniform(0.1, 0.9)) * size
    cx, cy = [(along, 0), (size, along), (along, size), (0, along)][side]
    axes = (int(rng.uniform(0.05, 0.12) * size), int(rng.uniform(0.15, 0.35) * size))
    color = tuple(int(c) for c in rng.uniform([90, 120, 170], [150, 175, 225]))  # BGR Hauttoene
    cv2.ellipse(scene, (int(cx), int(cy)), axes, float(rng.uniform(0, 180)), 0, 360, color, -1)


def compose(background_bgr, items, rng, size: int = 640):
    """items: Liste von (passcode, bgr, rel_window_or_None, groesse_von, groesse_bis).
    rel_window None = nacktes Artwork (Box = ganzes Bild). Liefert (szene, [(passcode, quad)])."""
    scene = cv2.resize(background_bgr, (size, size))
    placed = []  # (passcode, window_quad, window_mask, index)
    covers = []  # Maske je eingeklebtem Bild (Reihenfolge)
    for passcode, bgr, rel, lo, hi in items:
        warped, quad, w, h = _augment(bgr, rng)
        ch, cw = warped.shape[:2]
        scale = float(rng.uniform(lo, hi)) * size / max(ch, cw)
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
        warped = cv2.resize(warped, (nw, nh))
        ox = int(rng.uniform(-0.1 * nw, size - 0.9 * nw))
        oy = int(rng.uniform(-0.1 * nh, size - 0.9 * nh))
        items_to_paste = [(warped, quad * scale, ox, oy)]
        # Versetzter Stapel gleicher Karte darunter (nur ganze Karten).
        if rel is not None and rng.random() < 0.3:
            below = []
            for _ in range(int(rng.integers(1, 4))):
                dx, dy = rng.uniform(-0.06, 0.06, 2) * np.array([nw, nh])
                below.append((warped, quad * scale, ox + int(dx), oy + int(dy)))
            items_to_paste = below + items_to_paste
        for wimg, q, x, y in items_to_paste:
            compose_scene._paste_rgba(scene, wimg, x, y)
            full = np.zeros((size, size), np.uint8)
            alpha = (wimg[:, :, 3] > 0).astype(np.uint8)
            x0, y0 = max(x, 0), max(y, 0)
            x1, y1 = min(x + wimg.shape[1], size), min(y + wimg.shape[0], size)
            if x1 > x0 and y1 > y0:
                full[y0:y1, x0:x1] = alpha[y0 - y:y1 - y, x0 - x:x1 - x]
            covers.append(full)
            if rel is None:
                win = q + np.float32([x, y])
            else:
                win = warp_window(w, h, q, rel) + np.float32([x, y])
            placed.append((passcode, win, _poly_mask(size, win), len(covers) - 1))
    if rng.random() < 0.2:
        _finger(scene, rng)
    boxes = []
    for passcode, win, mask, idx in placed:
        area = int(mask.sum())
        if area < 16:
            continue
        hidden = np.zeros_like(mask)
        for later in covers[idx + 1:]:
            hidden |= later
        visible = int((mask & (1 - hidden)).sum()) / area
        inside = area / max(1, int(_poly_mask(size * 3, win + size).sum()))  # Anteil im Bild
        if visible >= MIN_VISIBLE and inside >= MIN_VISIBLE:
            boxes.append((passcode, win))
    return scene, boxes
