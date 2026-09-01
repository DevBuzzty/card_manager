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


def add_holo_foil(bgr: np.ndarray, rng: np.random.Generator, strength: float | None = None) -> np.ndarray:
    """Procedural holographic/foil sheen: a rainbow spectrum along a random axis, modulated by
    fine diagonal 'holo' bands, screen-blended onto the art. Approximates how a Secret/Ultimate
    Rare looks under the camera — the single biggest gap for real-photo recognition."""
    h, w = bgr.shape[:2]
    s = float(rng.uniform(0.25, 0.7)) if strength is None else strength
    angle = float(rng.uniform(0, np.pi))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = xx * np.cos(angle) + yy * np.sin(angle)
    proj = (proj - proj.min()) / (float(proj.max() - proj.min()) + 1e-6)
    freq = float(rng.uniform(1.0, 4.0))
    phase = float(rng.uniform(0.0, 1.0))
    hue = (((proj * freq + phase) % 1.0) * 179).astype(np.uint8)          # OpenCV hue 0..179
    hsv = cv2.merge([hue, np.full((h, w), 235, np.uint8), np.full((h, w), 255, np.uint8)])
    rainbow = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR).astype(np.float32) / 255.0
    # fine diagonal bands (perpendicular-ish to the spectrum axis)
    ba = angle + np.pi / 2
    band_proj = xx * np.cos(ba) + yy * np.sin(ba)
    bands = 0.5 + 0.5 * np.sin(band_proj * float(rng.uniform(0.25, 1.1)) + float(rng.uniform(0, 6.28)))
    mask = (bands.astype(np.float32) * s)[..., None]
    base = bgr.astype(np.float32) / 255.0
    screened = 1.0 - (1.0 - base) * (1.0 - rainbow * mask)              # 'screen' blend
    return np.clip(screened * 255.0, 0, 255).astype(np.uint8)


def photo_domain(bgr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Camera/print domain shift: white balance, gamma, vignette, chroma shift, JPEG artifacts —
    pushes the clean digital art toward how a phone photo of a printed card actually looks."""
    out = bgr.astype(np.float32)
    out *= rng.uniform(0.85, 1.15, size=3).astype(np.float32)[None, None, :]  # white balance
    out = np.clip(out, 0, 255)
    g = float(rng.uniform(0.7, 1.4))
    out = np.clip(((out / 255.0) ** g) * 255.0, 0, 255)
    if rng.random() < 0.5:  # vignette
        h, w = out.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
        vig = np.clip(1.0 - float(rng.uniform(0.15, 0.5)) * (r ** 2), 0.3, 1.0)
        out *= vig[..., None]
    out = out.astype(np.uint8)
    if rng.random() < 0.4:  # chromatic aberration
        sh = int(rng.integers(1, 3))
        b, gr, r = cv2.split(out)
        r = np.roll(r, sh, axis=1)
        b = np.roll(b, -sh, axis=1)
        out = cv2.merge([b, gr, r])
    if rng.random() < 0.75:  # JPEG compression artifacts
        q = int(rng.integers(35, 92))
        ok, enc = cv2.imencode(".jpg", out, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        if ok:
            out = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    return out


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
