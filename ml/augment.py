import cv2
import numpy as np


def perspective_warp(rgba: np.ndarray, rng: np.random.Generator, max_warp: float = 0.25):
    h, w = rgba.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jitter = max_warp * np.array([w, h], dtype=np.float32)
    dst = src + rng.uniform(-1.0, 1.0, size=(4, 2)).astype(np.float32) * jitter
    dst -= dst.min(axis=0)  # in den positiven Bereich schieben
    out_w = int(np.ceil(dst[:, 0].max())) + 1
    out_h = int(np.ceil(dst[:, 1].max())) + 1
    m = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        rgba, m, (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return warped, dst


def jitter_lighting(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    alpha = float(rng.uniform(0.6, 1.4))   # Kontrast
    beta = float(rng.uniform(-40, 40))     # Helligkeit
    return cv2.convertScaleAbs(bgr, alpha=alpha, beta=beta)


def add_foil_glare(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    h, w = bgr.shape[:2]
    angle = float(rng.uniform(0, np.pi))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = xx * np.cos(angle) + yy * np.sin(angle)
    span = float(proj.max() - proj.min()) + 1e-6
    proj = (proj - proj.min()) / span
    center = float(rng.uniform(0.2, 0.8))
    width = float(rng.uniform(0.05, 0.2))
    streak = np.exp(-((proj - center) ** 2) / (2 * width ** 2))
    intensity = float(rng.uniform(40, 120))
    glare = (streak * intensity)[..., None]
    return np.clip(bgr.astype(np.float32) + glare, 0, 255).astype(np.uint8)


def add_blur_noise(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = bgr
    if rng.random() < 0.5:
        k = int(rng.choice([3, 5]))
        out = cv2.GaussianBlur(out, (k, k), 0)
    if rng.random() < 0.5:
        sigma = float(rng.uniform(2, 12))
        noise = rng.normal(0, sigma, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return out
